package com.metisai.mobile;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
import android.os.*;
import android.speech.RecognizerIntent;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

/** Microphone capture, explicit stop, and authenticated Metis transcription. */
final class NativeVoice {
    static final int PERMISSION=4201, SPEECH=4202;
    interface Connection { HttpURLConnection open(String path,String method)throws Exception; }
    private final Activity activity; private final Executor executor;private final Connection connection;
    private final Consumer<String> transcript;
    private final Handler timer=new Handler(Looper.getMainLooper());
    private MediaRecorder recorder;private File recording;private long started;private double seconds;
    private JSONObject preferences;private String chatId;private AlertDialog dialog;
    private TextView status;private Button stop;private boolean uploading,cancelled;private String idempotency;
    private HttpURLConnection pendingConnection;
    private NativeRealtimeVoice realtimeSession;
    private JSONObject activeConfiguration;
    NativeVoice(Activity a,Executor e,Connection c,Consumer<String> result){activity=a;executor=e;connection=c;transcript=result;}
    void start(JSONObject settings,String id){
        preferences=settings;activeConfiguration=settings;chatId=id;
        if(!settings.optBoolean("enabled",true)){Toast.makeText(activity,"Voice input is disabled in Settings",1).show();return;}
        if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},PERMISSION);return;}
        if("browser".equals(settings.optString("provider"))){
            Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_PROMPT,"Message Metis");
            try{activity.startActivityForResult(intent,SPEECH);}catch(ActivityNotFoundException ex){Toast.makeText(activity,"No Android speech recognizer installed. Select a server transcription provider in Settings.",1).show();}return;
        }
        if(settings.optBoolean("realtime") && "openai".equals(settings.optString("provider"))){
            realtimeSession=new NativeRealtimeVoice(activity,executor,(path,method)->connection.open(path,method),settings.optString("modelId","gpt-realtime-whisper"),settings.optString("connectionId"),id,transcript);
            realtimeSession.start(); return;
        }
        begin();
    }
    void permissionResult(int[] grants){if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)start(preferences,chatId);else Toast.makeText(activity,"Microphone permission required",1).show();}
    void speechResult(int result,Intent data){if(result==Activity.RESULT_OK&&data!=null){java.util.ArrayList<String> results=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);if(results!=null&&!results.isEmpty())transcript.accept(results.get(0));}}
    private void begin(){
        close();cancelled=false;idempotency=UUID.randomUUID().toString();
        try{
            recording=File.createTempFile("metis-recording-",".m4a",activity.getCacheDir());
            recorder=new MediaRecorder();recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioSamplingRate(44100);recorder.setAudioEncodingBitRate(96000);recorder.setOutputFile(recording.getAbsolutePath());
            recorder.prepare();recorder.start();started=SystemClock.elapsedRealtime();
            LinearLayout form=new LinearLayout(activity);form.setOrientation(1);form.setPadding(32,24,32,24);
            status=new TextView(activity);status.setTextColor(0xfffafafa);status.setTextSize(14);status.setTypeface(android.graphics.Typeface.createFromAsset(activity.getAssets(),"fonts/geist_regular.ttf"));status.setContentDescription("Recording status");form.addView(status);
            stop=new Button(activity);stop.setText("Stop & transcribe");stop.setAllCaps(false);stop.setTypeface(android.graphics.Typeface.createFromAsset(activity.getAssets(),"fonts/geist_regular.ttf"));stop.setTextSize(14);stop.setTextColor(0xfffafafa);android.graphics.drawable.GradientDrawable bg=new android.graphics.drawable.GradientDrawable();bg.setColor(0xff171717);bg.setCornerRadius(20);bg.setStroke(2,0xff292929);stop.setBackground(bg);form.addView(stop);stop.setOnClickListener(v->{if(recorder!=null)finishRecording();else if(!uploading)upload();});
            dialog=new AlertDialog.Builder(activity).setTitle("Voice input").setView(form).setNegativeButton("Cancel",(d,w)->close()).create();
            dialog.setOnCancelListener(d->close());dialog.setOnDismissListener(d->{if(!uploading)close();});
            dialog.show();tick();
        }catch(Exception ex){close();Toast.makeText(activity,"Recording failed: "+ex.getMessage(),1).show();}
    }
    private void tick(){if(recorder==null)return;long elapsed=(SystemClock.elapsedRealtime()-started)/1000;status.setText("Recording · "+elapsed+" s");if(elapsed>=preferences.optInt("maxDurationSeconds",300)){finishRecording();return;}timer.postDelayed(this::tick,500);}
    private void finishRecording(){
        timer.removeCallbacksAndMessages(null);seconds=Math.min(preferences.optInt("maxDurationSeconds",300),Math.max(1,(SystemClock.elapsedRealtime()-started)/1000d));
        try{recorder.stop();recorder.release();recorder=null;upload();}
        catch(Exception ex){close();Toast.makeText(activity,"Recording too short. Try again.",1).show();}
    }
    private void upload(){
        if(recording==null||!recording.exists())return;uploading=true;stop.setEnabled(false);status.setText("Transcribing …");
        final File audio=recording;final double duration=seconds;final String chat=chatId,key=idempotency;final JSONObject config=preferences;
        executor.execute(()->{
            try{HttpURLConnection c=connection.open("/api/voice/transcribe","POST");pendingConnection=c;c.setReadTimeout(660000);c.setDoOutput(true);c.setRequestProperty("Idempotency-Key",key);
                String boundary="Metis"+UUID.randomUUID();c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);c.setChunkedStreamingMode(8192);
                JSONObject result;
                try{try(OutputStream out=c.getOutputStream()){writeMultipart(out,boundary,audio,duration,chat,config);}
                    int code=c.getResponseCode();InputStream stream=code>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(stream!=null)try(InputStream input=stream){byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1)bytes.write(buffer,0,n);}
                    result=new JSONObject(bytes.toString("UTF-8"));if(code<200||code>=300)throw new Exception(result.optString("error","Transcription HTTP "+code));
                }finally{c.disconnect();pendingConnection=null;}
                String text=result.optString("transcript");if(text.trim().isEmpty())throw new Exception("No speech detected");
                activity.runOnUiThread(()->{if(!key.equals(idempotency))return;uploading=false;if(cancelled||activity.isDestroyed()||activity.isFinishing()){close();return;}transcript.accept(text);dialog.dismiss();close();});
            }catch(Exception ex){activity.runOnUiThread(()->{if(!key.equals(idempotency))return;uploading=false;if(cancelled||activity.isDestroyed()||activity.isFinishing()){close();return;}status.setText(ex.getMessage());stop.setText("Retry transcription");stop.setEnabled(true);});}
        });
    }
    static void writeMultipart(OutputStream out,String boundary,File audio,double duration,String chat,JSONObject settings)throws Exception{
        field(out,boundary,"durationSeconds",Double.toString(duration));
        if(!chat.isEmpty())field(out,boundary,"chatId",chat);
        for(String name:new String[]{"provider","modelId","endpoint","connectionId"}){String value=settings.optString(name);if(!value.isEmpty())field(out,boundary,name,value);}
        out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        try(InputStream in=new FileInputStream(audio)){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}
        out.write(("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
    }
    private static void field(OutputStream out,String boundary,String name,String value)throws IOException{
        out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").getBytes(StandardCharsets.UTF_8));
    }
    void close(){
        cancelled=true;timer.removeCallbacksAndMessages(null);
        if(recorder!=null){try{recorder.stop();}catch(Exception ignored){}recorder.release();recorder=null;}
        if(pendingConnection!=null){pendingConnection.disconnect();pendingConnection=null;}
        if(recording!=null){recording.delete();recording=null;}
        if(realtimeSession!=null){NativeRealtimeVoice session=realtimeSession;realtimeSession=null;session.close();}
    }
    void backgrounded(){if(realtimeSession!=null){close();}else if(recorder!=null){close();if(dialog!=null)dialog.dismiss();}}
}
