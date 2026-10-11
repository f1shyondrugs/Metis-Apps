package com.metisai.mobile;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.view.*;
import android.view.accessibility.*;
import android.widget.*;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.*;
import org.junit.runner.RunWith;
import org.json.*;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeFeaturesTest {
    private Instrumentation instrumentation;
    private MainActivity activity;
    @Before public void launch() {
        instrumentation=InstrumentationRegistry.getInstrumentation();
        activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.waitForIdleSync();
        try { Thread.sleep(600); } catch (InterruptedException ignored) {}
    }
    @After public void close(){instrumentation.runOnMainSync(()->activity.finish());}
    private Object invoke(String name,Class<?>[] types,Object... args)throws Exception {
        Method m=MainActivity.class.getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(activity,args);
    }
    private void screenshot(String name)throws Exception {
        instrumentation.waitForIdleSync();Thread.sleep(250);
        Bitmap bitmap=instrumentation.getUiAutomation().takeScreenshot();
        File dir=new File(instrumentation.getTargetContext().getExternalFilesDir(null),"feature-evidence");dir.mkdirs();
        try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}
    }
    private int count(View v,Class<?> type){int n=type.isInstance(v)?1:0;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++)n+=count(g.getChildAt(i),type);}return n;}
    @Test public void graphSliderChangesFunctionAndMalformedSourceFallsBack()throws Exception {
        Map<String,Double> values=new HashMap<>();values.put("a",1d);
        assertEquals(1,NativeBoard.evaluate("a*sin(x)",Math.PI/2,values),1e-8);
        values.put("a",2d);assertEquals(2,NativeBoard.evaluate("a*sin(x)",Math.PI/2,values),1e-8);
        assertEquals(3,NativeBoard.evaluate("max(a,3)+ln(e)-1",0,values),1e-8);
        String source="Before\n\n```graph\n{\"title\":\"Sine with parameter\",\"bounds\":[-6,6,-3,3],\"elements\":[{\"type\":\"slider\",\"name\":\"a\",\"min\":-2,\"max\":2,\"value\":1},{\"type\":\"function\",\"fn\":\"a*sin(x)\"},{\"type\":\"point\",\"name\":\"P\",\"x\":1,\"y\":1}]}\n```\nAfter";
        AtomicReference<LinearLayout> result=new AtomicReference<>();
        instrumentation.runOnMainSync(()->{try{LinearLayout view=(LinearLayout)invoke("richContent",new Class[]{String.class},source);result.set(view);LinearLayout page=(LinearLayout)invoke("page",new Class[]{});ScrollView scroll=new ScrollView(activity);scroll.addView(view);page.addView(scroll);activity.setContentView(page);}catch(Exception ex){throw new RuntimeException(ex);}});
        assertEquals(1,count(result.get(),NativeBoard.class));assertEquals(1,count(result.get(),SeekBar.class));
        instrumentation.runOnMainSync(()->findSlider(result.get()).setProgress(1000));
        screenshot("graph");
        instrumentation.runOnMainSync(()->{try{LinearLayout fallback=(LinearLayout)invoke("richContent",new Class[]{String.class},"```graph\nINVALID\n```");assertEquals(0,count(fallback,NativeBoard.class));assertTrue(count(fallback,TextView.class)>0);}catch(Exception ex){throw new RuntimeException(ex);}});
    }
    private SeekBar findSlider(View v){if(v instanceof SeekBar)return (SeekBar)v;if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++){SeekBar s=findSlider(((ViewGroup)v).getChildAt(i));if(s!=null)return s;}return null;}
    @Test public void chartTypesRender()throws Exception {
        instrumentation.runOnMainSync(()->{try{LinearLayout l=new LinearLayout(activity);l.setOrientation(1);JSONObject spec=new JSONObject("{\"title\":\"Requests\",\"type\":\"bar\",\"x\":[\"Mon\",\"Tue\"],\"series\":[{\"name\":\"Metis\",\"values\":[12,18]}]}");l.addView(new NativeBoard(activity,spec,true));activity.setContentView(l);
            for(String type:new String[]{"line","area","pie","donut","scatter"}){JSONObject next=new JSONObject(spec.toString()).put("type",type);if(type.equals("scatter"))next.put("series",new JSONArray("[{\"name\":\"Samples\",\"points\":[[1,2],[3,4]]}]"));NativeBoard board=new NativeBoard(activity,next,true);board.measure(View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(900,View.MeasureSpec.EXACTLY));board.layout(0,0,800,900);board.draw(new Canvas(Bitmap.createBitmap(800,900,Bitmap.Config.ARGB_8888)));}assertEquals(1,count(l,NativeBoard.class));}catch(Exception ex){throw new RuntimeException(ex);}});
        screenshot("chart");
    }
    @Test public void settingsUsesPatchAndPreservesUneditedPreferences()throws Exception {
        AtomicReference<JSONObject> saved=new AtomicReference<>();
        NativeSettings.Api mock=(path,method,body)->{if(method.equals("PATCH")){saved.set(body);return new JSONObject().put("settings",body);}return new JSONObject().put("settings",new JSONObject("{\"voiceInput\":{\"provider\":\"openai\",\"endpoint\":\"https://example.test/v1\",\"connectionId\":\"existing\",\"realtime\":true,\"enabled\":true,\"modelId\":\"whisper-1\",\"maxDurationSeconds\":300}}"));};
        NativeSettings settings=new NativeSettings(activity,mock,Runnable::run,"https://metis.test",()->{});
        instrumentation.runOnMainSync(settings::open);clickText("Voice input");screenshot("settings");clickText("Save");
        assertNotNull(saved.get());JSONObject voice=saved.get().getJSONObject("voiceInput");assertEquals("existing",voice.getString("connectionId"));assertTrue(voice.getBoolean("realtime"));assertEquals("gpt-realtime-whisper",voice.getString("modelId"));assertEquals(300,voice.getInt("maxDurationSeconds"));
    }
    private AccessibilityNodeInfo find(AccessibilityNodeInfo root,String text){if(root==null)return null;if(root.getText()!=null&&text.equalsIgnoreCase(root.getText().toString()))return root;for(int i=0;i<root.getChildCount();i++){AccessibilityNodeInfo match=find(root.getChild(i),text);if(match!=null)return match;}return null;}
    private void clickText(String text)throws Exception {
        AccessibilityNodeInfo found=null;
        for(int i=0;i<30&&found==null;i++){found=find(instrumentation.getUiAutomation().getRootInActiveWindow(),text);if(found==null)Thread.sleep(100);}
        assertNotNull("Missing control: "+text,found);
        while(!found.isClickable()&&found.getParent()!=null)found=found.getParent();
        assertTrue(found.performAction(AccessibilityNodeInfo.ACTION_CLICK));instrumentation.waitForIdleSync();Thread.sleep(200);
    }
    @Test public void recordingUploadsMultipartAndReturnsTranscript()throws Exception {
        AtomicReference<String> transcript=new AtomicReference<>();ByteArrayOutputStream uploaded=new ByteArrayOutputStream();
        NativeVoice.Connection mock=(path,method)->new HttpURLConnection(new URL("https://metis.test"+path)){
            public void disconnect(){}public boolean usingProxy(){return false;}public void connect(){}
            public OutputStream getOutputStream(){return uploaded;}public int getResponseCode(){return 200;}
            public InputStream getInputStream(){return new ByteArrayInputStream("{\"transcript\":\"Native voice works\"}".getBytes(StandardCharsets.UTF_8));}
        };
        NativeVoice voice=new NativeVoice(activity,command->new Thread(command).start(),mock,transcript::set);
        instrumentation.runOnMainSync(()->{try{voice.start(new JSONObject("{\"provider\":\"openai\",\"modelId\":\"whisper-1\",\"enabled\":true,\"maxDurationSeconds\":5}"),"fixture-chat");}catch(Exception ex){throw new RuntimeException(ex);}});
        Thread.sleep(1800);screenshot("recording");clickText("Stop & transcribe");
        for(int i=0;i<50&&transcript.get()==null;i++)Thread.sleep(100);
        assertEquals("Native voice works",transcript.get());String body=uploaded.toString("ISO-8859-1");assertTrue(body.contains("name=\"file\""));assertTrue(body.contains("Content-Type: audio/mp4"));assertTrue(body.contains("name=\"durationSeconds\""));assertTrue(body.contains("fixture-chat"));assertTrue(uploaded.size()>1000);
        instrumentation.runOnMainSync(voice::close);
    }
    @Test public void authenticatedServerSettingsAndLogsContracts()throws Exception {
        org.junit.Assume.assumeTrue("Live server tests require explicit opt-in", "true".equals(InstrumentationRegistry.getArguments().getString("liveServer")));
        JSONObject before=(JSONObject)invoke("requestJson",new Class[]{String.class,String.class,JSONObject.class},"/api/preferences","GET",null);
        assertNotNull(before.optJSONObject("settings"));
        JSONObject saved=(JSONObject)invoke("requestJson",new Class[]{String.class,String.class,JSONObject.class},"/api/preferences","PATCH",new JSONObject());
        assertEquals(before.getJSONObject("settings").toString(),saved.getJSONObject("settings").toString());
        JSONObject providers=(JSONObject)invoke("requestJson",new Class[]{String.class,String.class,JSONObject.class},"/api/providers","GET",null);
        assertNotNull(providers.optJSONArray("connections"));
        JSONObject models=(JSONObject)invoke("requestJson",new Class[]{String.class,String.class,JSONObject.class},"/api/models","GET",null);
        assertNotNull(models.optJSONArray("models"));
        JSONObject search=(JSONObject)invoke("requestJson",new Class[]{String.class,String.class,JSONObject.class},"/api/chats/search?q=Native-Parity-OK&limit=1","GET",null);
        JSONArray results=search.optJSONArray("results");assertNotNull(results);assertTrue(results.length()>0);
        String id=results.getJSONObject(0).getString("chatId");
        JSONObject logs=(JSONObject)invoke("requestJson",new Class[]{String.class,String.class,JSONObject.class},"/api/chats/"+id+"/logs","GET",null);
        assertNotNull(logs.optJSONArray("logs"));assertTrue(logs.getJSONArray("logs").length()>0);
        assertNotNull(((JSONObject)invoke("requestJson",new Class[]{String.class,String.class,JSONObject.class},"/api/memories","GET",null)).optJSONArray("memories"));
        assertNotNull(((JSONObject)invoke("requestJson",new Class[]{String.class,String.class,JSONObject.class},"/api/skills","GET",null)).optJSONArray("skills"));
    }
    @Test public void toolDetailsShowInputOutputAndDiff()throws Exception {
        instrumentation.runOnMainSync(()->{try{invoke("showToolDetails",new Class[]{JSONObject.class},new JSONObject("{\"name\":\"edit_file\",\"kind\":\"edit\",\"status\":\"completed\",\"input\":{\"path\":\"demo.txt\"},\"output\":\"Updated\",\"diff\":{\"path\":\"demo.txt\",\"before\":\"old line\",\"after\":\"new line\"}}"));}catch(Exception ex){throw new RuntimeException(ex);}});
        screenshot("tool");clickText("Open diff");screenshot("diff");
        AccessibilityNodeInfo root=instrumentation.getUiAutomation().getRootInActiveWindow();assertNotNull(find(root,"old line"));assertNotNull(find(root,"new line"));
    }
    private void swipe(float x1,float y1,float x2,float y2)throws Exception {
        long down=android.os.SystemClock.uptimeMillis();instrumentation.sendPointerSync(MotionEvent.obtain(down,down,MotionEvent.ACTION_DOWN,x1,y1,0));
        for(int i=1;i<6;i++){long t=down+i*45;float p=i/6f;instrumentation.sendPointerSync(MotionEvent.obtain(down,t,MotionEvent.ACTION_MOVE,x1+(x2-x1)*p,y1+(y2-y1)*p,0));}
        instrumentation.sendPointerSync(MotionEvent.obtain(down,down+320,MotionEvent.ACTION_UP,x2,y2,0));instrumentation.waitForIdleSync();
    }
    @Test public void nativeBrowserControlsRender()throws Exception {
        instrumentation.runOnMainSync(()->{try{invoke("showBrowser",new Class[]{});}catch(Exception ex){throw new RuntimeException(ex);}});AccessibilityNodeInfo root=instrumentation.getUiAutomation().getRootInActiveWindow();for(String control:new String[]{"Address or search","Go","Back","Forward","Reload","History","Type"})assertNotNull("Missing browser control: "+control,find(root,control));screenshot("browser-controls");
    }
    @Test public void memoryAndSkillViewsRenderServerData()throws Exception {
        JSONArray memories=new JSONArray("[{\"id\":\"fixture\",\"content\":\"Remember the project palette\",\"tags\":[\"design\",\"metis\"]}]");JSONArray skills=new JSONArray("[{\"id\":\"review\",\"name\":\"Code review\",\"description\":\"Check changed files\",\"enabled\":true}]");
        instrumentation.runOnMainSync(()->{try{invoke("showMemories",new Class[]{JSONArray.class},memories);}catch(Exception ex){throw new RuntimeException(ex);}});assertNotNull(find(instrumentation.getUiAutomation().getRootInActiveWindow(),"Remember the project palette"));screenshot("memories");
        instrumentation.runOnMainSync(()->{try{invoke("showSkills",new Class[]{JSONArray.class},skills);}catch(Exception ex){throw new RuntimeException(ex);}});assertNotNull(find(instrumentation.getUiAutomation().getRootInActiveWindow(),"Code review"));assertNotNull(find(instrumentation.getUiAutomation().getRootInActiveWindow(),"Check changed files"));screenshot("skills");
    }
    @Test public void horizontalSwipeOpensAndClosesNativeSidebar()throws Exception {
        android.util.DisplayMetrics metrics=new android.util.DisplayMetrics();activity.getWindowManager().getDefaultDisplay().getRealMetrics(metrics);float y=metrics.heightPixels*.68f;
        swipe(metrics.widthPixels*.24f,y,metrics.widthPixels*.76f,y);assertNotNull(find(instrumentation.getUiAutomation().getRootInActiveWindow(),"Search chats"));screenshot("sidebar-open");
        swipe(metrics.widthPixels*.90f,y,metrics.widthPixels*.25f,y);Thread.sleep(260);assertNull(find(instrumentation.getUiAutomation().getRootInActiveWindow(),"Search chats"));screenshot("sidebar-closed");
    }
    @Test public void realtimeTranscriptEventsReachComposerOnlyOnStop()throws Exception {
        AtomicReference<String> result=new AtomicReference<>();NativeRealtimeVoice voice=new NativeRealtimeVoice(activity,Runnable::run,(path,method)->{throw new IOException("unexpected network");},"gpt-realtime-whisper","","",result::set);
        instrumentation.runOnMainSync(()->{voice.event("{\"type\":\"conversation.item.input_audio_transcription.delta\",\"delta\":\"Hello \"}");assertNull(result.get());voice.event("{\"type\":\"conversation.item.input_audio_transcription.completed\",\"transcript\":\"Hello Metis\"}");voice.stop(true);});
        assertEquals("Hello Metis",result.get());
    }
    @Test public void realtimeWebRtcEngineInitializesOnAndroid()throws Exception {instrumentation.runOnMainSync(()->NativeRealtimeVoice.validateEngine(activity));}
}
