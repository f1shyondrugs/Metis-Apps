package com.metisai.mobile;

import android.Manifest;
import android.app.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.graphics.Typeface;
import android.widget.*;
import org.json.*;
import org.webrtc.*;
import org.webrtc.audio.JavaAudioDeviceModule;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.lang.reflect.*;
import java.util.function.Consumer;

/** Native Android WebRTC transcription over a short lived credential issued by Metis. */
final class NativeRealtimeVoice {
    interface Server { HttpURLConnection open(String path,String method)throws Exception; }
    private final Activity activity;private final Executor executor;private final Server server;
    private final String model,connectionId,chatId;private final Consumer<String> transcript;
    private final Handler handler=new Handler(Looper.getMainLooper());private final AtomicBoolean exchanged=new AtomicBoolean();
    private PeerConnectionFactory factory;private JavaAudioDeviceModule adm;private PeerConnection peer;
    private AudioSource source;private AudioTrack audioTrack;private DataChannel channel;
    private AlertDialog dialog;private TextView preview;private String token="",partial="",complete="";
    private boolean closed,connected;private long started;private static boolean initialized;
    NativeRealtimeVoice(Activity a,Executor e,Server s,String model,String connectionId,String chatId,Consumer<String> done){
        activity=a;executor=e;server=s;this.model=model==null||model.isEmpty()?"gpt-realtime-whisper":model;
        this.connectionId=connectionId==null?"":connectionId;this.chatId=chatId==null?"":chatId;transcript=done;
    }
    private static synchronized void init(Activity a){if(initialized)return;
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(a.getApplicationContext()).createInitializationOptions());initialized=true;}
    static void validateEngine(Activity a){init(a);JavaAudioDeviceModule device=JavaAudioDeviceModule.builder(a.getApplicationContext()).createAudioDeviceModule();
        PeerConnectionFactory factory=null;try{factory=PeerConnectionFactory.builder().setAudioDeviceModule(device).createPeerConnectionFactory();if(factory==null)throw new IllegalStateException("WebRTC factory unavailable");}
        finally{if(factory!=null)factory.dispose();device.release();}}
    void start(){if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},NativeVoice.PERMISSION);return;}
        show("Connecting to Metis…");
        executor.execute(()->{try{
            JSONObject body=new JSONObject().put("modelId",model);if(!connectionId.isEmpty())body.put("connectionId",connectionId);
            JSONObject response=json(server.open("/api/voice/realtime","POST"),body.toString());
            JSONObject client=response.optJSONObject("client_secret");token=client==null?"":client.optString("value");
            if(token.isEmpty())throw new Exception(response.optString("error","Metis returned no realtime session token."));
            activity.runOnUiThread(()->{if(!closed)connect();});
        }catch(Exception ex){activity.runOnUiThread(()->fail(message(ex)));}});
    }
    private void connect(){
        try{
            init(activity);adm=JavaAudioDeviceModule.builder(activity.getApplicationContext()).createAudioDeviceModule();
            factory=PeerConnectionFactory.builder().setAudioDeviceModule(adm).createPeerConnectionFactory();
            ArrayList<PeerConnection.IceServer> iceServers=new ArrayList<>();
            iceServers.add(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer());
            peer=factory.createPeerConnection(new PeerConnection.RTCConfiguration(iceServers),peerObserver());
            if(peer==null)throw new Exception("Could not start encrypted realtime audio.");
            source=factory.createAudioSource(new MediaConstraints());audioTrack=factory.createAudioTrack("metis-audio",source);
            audioTrack.setEnabled(true);peer.addTrack(audioTrack,Collections.singletonList("audio"));
            DataChannel.Init init=new DataChannel.Init();init.ordered=true;channel=peer.createDataChannel("oai-events",init);channel.registerObserver(channelObserver());
            peer.createOffer(sdpObserver("offer"),new MediaConstraints());
        }catch(Exception ex){fail(message(ex));}
    }
    private Object observer(Class<?> api,InvocationHandler h){return java.lang.reflect.Proxy.newProxyInstance(api.getClassLoader(),new Class<?>[]{api},h);}
    private Object defaultValue(Class<?> type){if(!type.isPrimitive()||type==Void.TYPE)return null;if(type==Boolean.TYPE)return false;if(type==Character.TYPE)return '\0';return 0;}
    private PeerConnection.Observer peerObserver(){return (PeerConnection.Observer)observer(PeerConnection.Observer.class,(proxy,m,args)->{
        if(args!=null&&args.length>0){
            if(m.getName().equals("onIceGatheringChange")&&args[0]==PeerConnection.IceGatheringState.COMPLETE)sendOffer();
            if(m.getName().equals("onIceConnectionChange")){
                PeerConnection.IceConnectionState s=(PeerConnection.IceConnectionState)args[0];
                if(s==PeerConnection.IceConnectionState.CONNECTED||s==PeerConnection.IceConnectionState.COMPLETED)markConnected();
                else if(s==PeerConnection.IceConnectionState.FAILED)fail("Realtime audio could not connect.");
            }
            if(m.getName().equals("onConnectionChange")&&args[0]==PeerConnection.PeerConnectionState.FAILED)activity.runOnUiThread(()->fail("Realtime audio connection failed."));
        }return defaultValue(m.getReturnType());});}
    private DataChannel.Observer channelObserver(){return (DataChannel.Observer)observer(DataChannel.Observer.class,(proxy,m,args)->{
        if(m.getName().equals("onMessage")&&args!=null&&args.length>0){DataChannel.Buffer b=(DataChannel.Buffer)args[0];if(!b.binary){ByteBuffer copy=b.data.duplicate();byte[] bytes=new byte[copy.remaining()];copy.get(bytes);activity.runOnUiThread(()->event(new String(bytes,StandardCharsets.UTF_8)));}}
        if(m.getName().equals("onStateChange")&&channel!=null&&channel.state()==DataChannel.State.OPEN)markConnected();
        return defaultValue(m.getReturnType());});}
    private SdpObserver sdpObserver(String operation){return (SdpObserver)observer(SdpObserver.class,(proxy,m,args)->{
        if(m.getName().equals("onCreateSuccess")&&args!=null&&args.length>0&&peer!=null)peer.setLocalDescription(sdpObserver("local"),(SessionDescription)args[0]);
        else if(m.getName().equals("onSetSuccess")&&"local".equals(operation)&&peer.iceGatheringState()==PeerConnection.IceGatheringState.COMPLETE)sendOffer();
        else if(m.getName().equals("onCreateFailure")||m.getName().equals("onSetFailure"))fail(args!=null&&args.length>0?String.valueOf(args[0]):"Could not prepare realtime audio.");
        return defaultValue(m.getReturnType());});}
    private void sendOffer(){if(closed||peer==null||!exchanged.compareAndSet(false,true))return;
        SessionDescription offer=peer.getLocalDescription();if(offer==null){fail("WebRTC produced no audio offer.");return;}show("Negotiating secure audio…");
        executor.execute(()->{HttpURLConnection c=null;try{
            String address="https://api.openai.com/v1/realtime/calls?model="+URLEncoder.encode(model,"UTF-8");
            c=(HttpURLConnection)new URL(address).openConnection();c.setRequestMethod("POST");c.setConnectTimeout(15000);c.setReadTimeout(30000);c.setDoOutput(true);
            c.setRequestProperty("Authorization","Bearer "+token);c.setRequestProperty("Content-Type","application/sdp");c.setRequestProperty("Accept","application/sdp");token="";
            try(OutputStream out=c.getOutputStream()){out.write(offer.description.getBytes(StandardCharsets.UTF_8));}
            int code=c.getResponseCode();String answer=read(code>=400?c.getErrorStream():c.getInputStream());
            if(code<200||code>=300)throw new Exception(providerError(answer,code));
            activity.runOnUiThread(()->{if(!closed&&peer!=null)peer.setRemoteDescription(sdpObserver("remote"),new SessionDescription(SessionDescription.Type.ANSWER,answer));});
        }catch(Exception ex){activity.runOnUiThread(()->fail(message(ex)));}finally{if(c!=null)c.disconnect();}});
    }
    void event(String raw){if(closed)return;try{JSONObject e=new JSONObject(raw);String type=e.optString("type");
        if(type.contains("transcription.delta")||"response.audio_transcript.delta".equals(type)){partial+=e.optString("delta");show("Listening\n"+partial);}
        else if(type.contains("transcription.completed")||type.endsWith("audio_transcript.done")){complete=e.optString("transcript",e.optString("text"));if(!complete.isEmpty()){partial=complete;show("Transcript ready\n"+complete);}}
        else if(type.contains("transcription.failed")||"error".equals(type)){JSONObject error=e.optJSONObject("error");show(error==null?"Realtime transcription failed":error.optString("message","Realtime transcription failed"));}
    }catch(Exception ignored){}}
    private void markConnected(){if(closed||connected)return;connected=true;started=SystemClock.elapsedRealtime();show("Listening · speak naturally.\n");handler.post(tick);}
    private final Runnable tick=new Runnable(){public void run(){if(closed||!connected)return;show("Listening · "+((SystemClock.elapsedRealtime()-started)/1000)+" s\n"+partial);handler.postDelayed(this,600);}};
    private void show(String text){if(activity.isDestroyed()||activity.isFinishing())return;
        if(dialog==null){int d=(int)(activity.getResources().getDisplayMetrics().density+.5f);LinearLayout form=new LinearLayout(activity);form.setOrientation(1);form.setPadding(18*d,14*d,18*d,12*d);
            preview=new TextView(activity);preview.setTextColor(0xffa3a3a3);preview.setTextSize(14);preview.setTypeface(Typeface.createFromAsset(activity.getAssets(),"fonts/geist_regular.ttf"));preview.setMinHeight(56*d);form.addView(preview);
            Button done=new Button(activity);done.setText("Stop & add transcript");done.setAllCaps(false);form.addView(done);done.setOnClickListener(v->stop(true));
            dialog=new AlertDialog.Builder(activity).setTitle("Realtime voice").setView(form).setNegativeButton("Cancel",(x,w)->stop(false)).create();
            dialog.setOnCancelListener(x->stop(false));dialog.setOnDismissListener(x->{if(!closed)stop(false);});dialog.show();}
        preview.setText(text);
    }
    void stop(boolean keep){if(closed)return;String result=complete.isEmpty()?partial:complete;close();
        if(keep&&!result.trim().isEmpty())transcript.accept(result.trim());else if(keep)Toast.makeText(activity,"No speech was detected.",Toast.LENGTH_SHORT).show();}
    private void fail(String reason){if(closed||activity.isDestroyed()||activity.isFinishing())return;release();show(reason+"\n\nThe recording was not sent.");if(dialog!=null)dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setText("Close");}
    void backgrounded(){stop(false);}
    void close(){if(closed)return;closed=true;handler.removeCallbacksAndMessages(null);release();if(dialog!=null&&dialog.isShowing())dialog.dismiss();dialog=null;token="";}
    private void release(){try{if(channel!=null){channel.unregisterObserver();channel.close();channel.dispose();}}catch(Exception ignored){}channel=null;
        try{if(audioTrack!=null){audioTrack.setEnabled(false);audioTrack.dispose();}}catch(Exception ignored){}audioTrack=null;
        try{if(source!=null)source.dispose();}catch(Exception ignored){}source=null;
        try{if(peer!=null){peer.close();peer.dispose();}}catch(Exception ignored){}peer=null;
        try{if(factory!=null)factory.dispose();}catch(Exception ignored){}factory=null;
        try{if(adm!=null)adm.release();}catch(Exception ignored){}adm=null;}
    private JSONObject json(HttpURLConnection c,String body)throws Exception{c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}int status=c.getResponseCode();String text=read(status>=400?c.getErrorStream():c.getInputStream());c.disconnect();JSONObject value=new JSONObject(text);if(status<200||status>=300)throw new Exception(value.optString("error","Metis could not create a realtime token."));return value;}
    private String read(InputStream in)throws Exception{if(in==null)return "";try(InputStream input=in;ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=input.read(b))!=-1)bytes.write(b,0,n);return bytes.toString("UTF-8");}}
    private String providerError(String body,int code){try{JSONObject e=new JSONObject(body).optJSONObject("error");if(e!=null)return e.optString("message","Realtime service returned HTTP "+code);}catch(Exception ignored){}return "Realtime service returned HTTP "+code;}
    private String message(Exception e){return e.getMessage()==null?"Realtime voice connection failed.":e.getMessage();}
}
