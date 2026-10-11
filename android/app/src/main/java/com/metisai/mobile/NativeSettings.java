package com.metisai.mobile;

import android.app.*;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.widget.*;
import android.view.*;
import org.json.*;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

final class NativeSettings {
    interface Api {JSONObject request(String path,String method,JSONObject body)throws Exception;}
    private final Activity activity; private final Api api;private final Executor executor;
    private final Runnable reload;private final String server;
    private final Typeface font;private JSONObject settings=new JSONObject();
    NativeSettings(Activity a,Api api,Executor executor,String server,Runnable reload){
        activity=a;this.api=api;this.executor=executor;this.server=server;this.reload=reload;
        font=Typeface.createFromAsset(a.getAssets(),"fonts/geist_regular.ttf");
    }
    private int dp(int n){return (int)(n*activity.getResources().getDisplayMetrics().density+.5f);}
    private LinearLayout form(){LinearLayout l=new LinearLayout(activity);l.setOrientation(1);l.setPadding(dp(16),dp(8),dp(16),dp(16));l.setBackgroundColor(0xff0e0e0e);return l;}
    private TextView label(String s){TextView t=new TextView(activity);t.setTypeface(font);t.setText(s);t.setTextSize(13);t.setTextColor(0xffa3a3a3);t.setPadding(0,dp(10),0,dp(5));return t;}
    private EditText field(LinearLayout l,String name,String value){l.addView(label(name));EditText e=new EditText(activity);e.setTypeface(font);e.setTextColor(Color.WHITE);e.setTextSize(14);e.setSingleLine();e.setText(value);e.setContentDescription(name);
        GradientDrawable bg=new GradientDrawable();bg.setColor(0xff121212);bg.setCornerRadius(dp(8));bg.setStroke(dp(1),0xff292929);e.setBackground(bg);e.setPadding(dp(10),dp(10),dp(10),dp(10));l.addView(e,new LinearLayout.LayoutParams(-1,-2));return e;}
    private Switch toggle(LinearLayout l,String name,boolean value){Switch s=new Switch(activity);s.setTypeface(font);s.setText(name);s.setTextSize(14);s.setTextColor(Color.WHITE);s.setChecked(value);l.addView(s,new LinearLayout.LayoutParams(-1,dp(48)));return s;}
    private Spinner choice(LinearLayout l,String name,String[] options,String selected){l.addView(label(name));Spinner s=new Spinner(activity);ArrayAdapter<String> adapter=new ArrayAdapter<>(activity,android.R.layout.simple_spinner_dropdown_item,options);s.setAdapter(adapter);for(int i=0;i<options.length;i++)if(options[i].equals(selected))s.setSelection(i);l.addView(s,new LinearLayout.LayoutParams(-1,dp(44)));return s;}
    private ScrollView scroll(LinearLayout l){ScrollView s=new ScrollView(activity);s.addView(l);return s;}
    private void button(LinearLayout l,String name,Runnable action){Button b=new Button(activity);b.setText(name);b.setAllCaps(false);b.setTextSize(14);b.setTypeface(font);b.setTextColor(Color.WHITE);GradientDrawable bg=new GradientDrawable();bg.setColor(0xff171717);bg.setCornerRadius(dp(8));bg.setStroke(dp(1),0xff292929);b.setBackground(bg);l.addView(b,new LinearLayout.LayoutParams(-1,dp(48)));b.setOnClickListener(v->action.run());}
    private void run(String path,String method,JSONObject body,Consumer<JSONObject> success){
        executor.execute(()->{try{JSONObject result=api.request(path,method,body);activity.runOnUiThread(()->{if(!activity.isDestroyed())success.accept(result);});}
        catch(Exception ex){activity.runOnUiThread(()->new AlertDialog.Builder(activity).setTitle("Server request failed").setMessage(ex.getMessage()).setPositiveButton("Close",null).show());}});
    }
    void open(){run("/api/preferences","GET",null,data->{settings=data.optJSONObject("settings");if(settings==null)settings=new JSONObject();menu();});}
    private void menu(){LinearLayout l=form();l.addView(label(server));button(l,"Voice input",this::voice);button(l,"Models & parameters",this::models);button(l,"Provider connections",this::providers);button(l,"Browser",this::browser);button(l,"Compression",this::compression);button(l,"Features",this::features);
        new AlertDialog.Builder(activity).setTitle("Settings").setView(scroll(l)).setNegativeButton("Close",null).show();}
    interface Value {JSONObject get()throws Exception;}
    private void saveDialog(String title,LinearLayout l,Value value){
        AlertDialog d=new AlertDialog.Builder(activity).setTitle(title).setView(scroll(l)).setNegativeButton("Cancel",null).setPositiveButton("Save",null).create();
        d.setOnShowListener(ignored->d.getButton(-1).setOnClickListener(v->{try{JSONObject patch=value.get();d.getButton(-1).setEnabled(false);
            executor.execute(()->{try{JSONObject result=api.request("/api/preferences","PATCH",patch);activity.runOnUiThread(()->{JSONObject saved=result.optJSONObject("settings");if(saved!=null)settings=saved;d.dismiss();Toast.makeText(activity,"Saved on server",Toast.LENGTH_SHORT).show();reload.run();});}
                catch(Exception ex){activity.runOnUiThread(()->{d.getButton(-1).setEnabled(true);Toast.makeText(activity,ex.getMessage(),Toast.LENGTH_LONG).show();});}});
        }catch(Exception ex){Toast.makeText(activity,ex.getMessage(),Toast.LENGTH_LONG).show();}}));d.show();
    }
    private JSONObject object(String key){JSONObject o=settings.optJSONObject(key);return o==null?new JSONObject():o;}
    private void voice(){JSONObject current=object("voiceInput");LinearLayout l=form();
        Switch enabled=toggle(l,"Enable voice input",current.optBoolean("enabled",true));
        Spinner provider=choice(l,"Provider",new String[]{"openai","local","custom","browser"},current.optString("provider","openai"));
        EditText model=field(l,"Transcription model",current.optString("modelId",current.optBoolean("realtime")?"gpt-realtime-whisper":"whisper-1"));
        Switch realtime=toggle(l,"Realtime voice over WebRTC",current.optBoolean("realtime"));
        l.addView(label("Realtime mode requires an OpenAI voice connection. Words appear while you speak and stay in the draft until you stop."));
        EditText endpoint=field(l,"Endpoint (optional)",current.optString("endpoint"));
        EditText connection=field(l,"Connection ID (optional)",current.optString("connectionId"));
        EditText duration=field(l,"Maximum recording seconds (1–3600)",current.optString("maxDurationSeconds","300"));duration.setInputType(2);
        l.addView(label("Recordings are transcribed after stopping. Browser uses Android speech recognition. Existing realtime preferences are retained."));
        saveDialog("Voice input",l,()->{int max=Integer.parseInt(duration.getText().toString());if(max<1||max>3600)throw new Exception("Duration must be 1–3600 seconds");
            String providerId=provider.getSelectedItem().toString();if(realtime.isChecked()&&!"openai".equals(providerId))throw new Exception("Realtime WebRTC currently requires an OpenAI voice connection.");String modelId=model.getText().toString();if(realtime.isChecked()&&modelId.equals("whisper-1")){modelId="gpt-realtime-whisper";model.setText(modelId);}JSONObject next=new JSONObject(current.toString()).put("enabled",enabled.isChecked()).put("provider",providerId).put("modelId",modelId).put("endpoint",endpoint.getText().toString()).put("connectionId",connection.getText().toString()).put("maxDurationSeconds",max).put("realtime",realtime.isChecked());return new JSONObject().put("voiceInput",next);});
    }
    private void browser(){LinearLayout l=form();Switch realtime=toggle(l,"Live browser view",settings.optBoolean("browserRealtime"));
        EditText fps=field(l,"Frames per second",settings.optString("browserFps","5"));fps.setInputType(2);
        EditText width=field(l,"Viewport width",settings.optString("browserViewportWidth","1280"));width.setInputType(2);
        EditText height=field(l,"Viewport height",settings.optString("browserViewportHeight","800"));height.setInputType(2);
        saveDialog("Browser",l,()->new JSONObject().put("browserRealtime",realtime.isChecked()).put("browserFps",Integer.parseInt(fps.getText().toString())).put("browserViewportWidth",Integer.parseInt(width.getText().toString())).put("browserViewportHeight",Integer.parseInt(height.getText().toString())));}
    private void compression(){JSONObject c=object("compression");LinearLayout l=form();Switch enabled=toggle(l,"Enable compression",c.optBoolean("enabled"));Spinner mode=choice(l,"Mode",new String[]{"lite","standard","aggressive","ultra","rtk","stacked"},c.optString("mode","standard"));
        Switch tools=toggle(l,"Compress tool results",c.optBoolean("compressToolResults",true)),history=toggle(l,"Compress chat history",c.optBoolean("compressChatHistory",true));
        saveDialog("Compression",l,()->new JSONObject().put("compression",new JSONObject().put("enabled",enabled.isChecked()).put("mode",mode.getSelectedItem().toString()).put("compressToolResults",tools.isChecked()).put("compressChatHistory",history.isChecked())));}
    private void features(){LinearLayout l=form();JSONObject f=object("featureFlags");String[] keys={"plans","notes","recovery","askUserTimeout","voiceInput","browser"};String[] names={"Plans","Notes","Recovery","Question timeout","Voice input","Browser"};Switch[] toggles=new Switch[keys.length];for(int i=0;i<keys.length;i++)toggles[i]=toggle(l,names[i],f.optBoolean(keys[i],true));saveDialog("Features",l,()->{JSONObject patch=new JSONObject();for(int i=0;i<keys.length;i++)patch.put(keys[i],toggles[i].isChecked());return new JSONObject().put("featureFlags",patch);});}
    private void models(){run("/api/models","GET",null,data->{JSONArray a=data.optJSONArray("models");if(a==null||a.length()==0)return;String[] names=new String[a.length()];for(int i=0;i<a.length();i++)names[i]=a.optJSONObject(i).optString("displayName",a.optJSONObject(i).optString("id"));new AlertDialog.Builder(activity).setTitle("Models").setItems(names,(d,n)->model(a.optJSONObject(n))).setNegativeButton("Close",null).show();});}
    private void model(JSONObject model){LinearLayout l=form();String id=model.optString("id");l.addView(label(model.optString("displayName",id)));Switch defaultModel=toggle(l,"Use as default model",id.equals(settings.optString("modelId")));Switch subagent=toggle(l,"Use for subagents",id.equals(settings.optString("subagentModelId"))&&settings.optBoolean("subagentModelEnabled"));JSONObject byModel=object("modelParamsByModel");JSONArray current=byModel.optJSONArray(id);if(current==null)current=settings.optJSONArray("modelParams");JSONArray params=model.optJSONArray("parameters");java.util.ArrayList<Spinner> choices=new java.util.ArrayList<>();java.util.ArrayList<String> keys=new java.util.ArrayList<>();
        if(params!=null)for(int i=0;i<params.length();i++){JSONObject p=params.optJSONObject(i);if(p==null)continue;JSONArray values=p.optJSONArray("values");if(values==null||values.length()==0)continue;String key=p.optString("id"),selected="";if(current!=null)for(int j=0;j<current.length();j++){JSONObject pair=current.optJSONObject(j);if(pair!=null&&key.equals(pair.optString("id")))selected=pair.optString("value");}
            String[] options=new String[values.length()];for(int j=0;j<options.length;j++)options[j]=values.optJSONObject(j).optString("value");keys.add(key);choices.add(choice(l,p.optString("displayName",key),options,selected));}
        saveDialog("Model settings",l,()->{JSONArray values=new JSONArray();for(int i=0;i<keys.size();i++)values.put(new JSONObject().put("id",keys.get(i)).put("value",choices.get(i).getSelectedItem().toString()));JSONObject patch=new JSONObject();JSONObject next=new JSONObject(byModel.toString()).put(id,values);patch.put("modelParamsByModel",next);if(defaultModel.isChecked())patch.put("modelId",id).put("modelParams",values);if(subagent.isChecked())patch.put("subagentModelEnabled",true).put("subagentModelId",id);else if(id.equals(settings.optString("subagentModelId")))patch.put("subagentModelEnabled",false);return patch;});}
    private void providers(){run("/api/providers","GET",null,data->{LinearLayout l=form();JSONArray connections=data.optJSONArray("connections");if(connections!=null)for(int i=0;i<connections.length();i++){JSONObject c=connections.optJSONObject(i);if(c!=null)button(l,c.optString("label",c.optString("providerKey"))+(c.optBoolean("enabled")?"":" · disabled"),()->connection(c));}
        button(l,"Add connection",()->{JSONArray defs=data.optJSONArray("providers");if(defs==null)return;String[] names=new String[defs.length()];for(int i=0;i<names.length;i++)names[i]=defs.optJSONObject(i).optString("name");new AlertDialog.Builder(activity).setTitle("Provider").setItems(names,(d,i)->addConnection(defs.optJSONObject(i))).show();});
        new AlertDialog.Builder(activity).setTitle("Provider connections").setView(scroll(l)).setNegativeButton("Close",null).show();});}
    private void connection(JSONObject c){LinearLayout l=form();EditText name=field(l,"Name",c.optString("label")),url=field(l,"Base URL",c.optString("baseUrl")),secret=field(l,"New API key (blank retains key)","");secret.setInputType(129);Switch enabled=toggle(l,"Enabled",c.optBoolean("enabled",true));l.addView(label("Connection ID: "+c.optString("id")));
        button(l,"Test connection",()->run("/api/providers/"+c.optString("id")+"/test","POST",new JSONObject(),result->new AlertDialog.Builder(activity).setTitle("Connection test").setMessage(result.toString()).setPositiveButton("Close",null).show()));
        AlertDialog d=new AlertDialog.Builder(activity).setTitle(c.optString("providerKey")).setView(scroll(l)).setNegativeButton("Close",null).setPositiveButton("Save",null).create();
        d.setOnShowListener(ignored->d.getButton(-1).setOnClickListener(v->{try{JSONObject patch=new JSONObject().put("label",name.getText().toString()).put("baseUrl",url.getText().toString()).put("enabled",enabled.isChecked());if(secret.length()>0)patch.put("secret",secret.getText().toString());run("/api/providers/"+c.optString("id"),"PATCH",patch,result->{secret.setText("");d.dismiss();reload.run();});}catch(Exception ex){}}));d.show();}
    private void addConnection(JSONObject definition){LinearLayout l=form();JSONArray allowed=definition.optJSONArray("authTypes");java.util.ArrayList<String> supported=new java.util.ArrayList<>();if(allowed!=null)for(int i=0;i<allowed.length();i++){String t=allowed.optString(i);if("api_key".equals(t)||"local".equals(t))supported.add(t);}
        if(supported.isEmpty()){new AlertDialog.Builder(activity).setTitle(definition.optString("name")).setMessage(definition.optString("setupHint")+"\nAccount/OAuth setup must currently be completed on the server. Existing connections work in this app.").setPositiveButton("Close",null).show();return;}
        EditText name=field(l,"Name",definition.optString("name")),url=field(l,"Base URL",definition.optString("defaultBaseUrl")),secret=field(l,"API key","");secret.setInputType(129);Spinner auth=choice(l,"Authentication",supported.toArray(new String[0]),supported.get(0));
        AlertDialog d=new AlertDialog.Builder(activity).setTitle("Add connection").setView(scroll(l)).setNegativeButton("Cancel",null).setPositiveButton("Add",null).create();
        d.setOnShowListener(ignored->d.getButton(-1).setOnClickListener(v->{try{JSONObject body=new JSONObject().put("providerKey",definition.getString("key")).put("label",name.getText().toString()).put("baseUrl",url.getText().toString()).put("authType",auth.getSelectedItem().toString()).put("secret",secret.getText().toString()).put("enabled",true);run("/api/providers","POST",body,result->{secret.setText("");d.dismiss();reload.run();});}catch(Exception ex){}}));d.show();}
}
