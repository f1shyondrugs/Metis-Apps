package com.metisai.mobile;

import android.content.Context;
import android.graphics.*;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.*;
import net.objecthunter.exp4j.Expression;
import net.objecthunter.exp4j.ExpressionBuilder;
import net.objecthunter.exp4j.function.Function;

/** Metis graph/chart JSON rendered on Android Canvas, without embedded HTML. */
public final class NativeBoard extends LinearLayout {
    private final Plot plot;
    private int dp(float n) { return (int)(n*getResources().getDisplayMetrics().density+.5f); }
    public NativeBoard(Context context, JSONObject spec, boolean chart) throws Exception {
        super(context); setOrientation(VERTICAL); setPadding(dp(8),dp(8),dp(8),dp(8));
        setBackgroundColor(Color.rgb(14,14,14));
        TextView title = text(spec.optString("title", chart ? "Chart" : "Graph"));
        title.setTextSize(14); addView(title);
        plot = new Plot(context,spec,chart); addView(plot,new LayoutParams(-1,dp(270)));
        if (!chart) {
            JSONArray elements=spec.optJSONArray("elements");
            if (elements==null || elements.length()==0) throw new Exception("Graph requires elements");
            for(int i=0;i<elements.length();i++) {
                JSONObject e=elements.getJSONObject(i);
                if (!"slider".equals(e.optString("type"))) continue;
                String name=e.optString("name","a");
                double min=e.optDouble("min",-5),max=e.optDouble("max",5);
                if(max<=min) throw new Exception("Invalid slider range");
                double value=Math.max(min,Math.min(max,e.optDouble("value",(min+max)/2)));
                plot.values.put(name,value);
                TextView label=text(name+" = "+format(value)); addView(label);
                SeekBar slider=new SeekBar(context); slider.setContentDescription("Parameter "+name);
                slider.setMax(1000);slider.setProgress((int)((value-min)/(max-min)*1000));
                addView(slider,new LayoutParams(-1,dp(40)));
                slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
                    public void onStartTrackingTouch(SeekBar s){} public void onStopTrackingTouch(SeekBar s){}
                    public void onProgressChanged(SeekBar s,int progress,boolean user){
                        double v=min+(max-min)*progress/1000d, step=e.optDouble("step",0);
                        if(step>0)v=min+Math.round((v-min)/step)*step;
                        v=Math.max(min,Math.min(max,v));plot.values.put(name,v);
                        label.setText(name+" = "+format(v)); plot.invalidate();
                    }
                });
            }
            Button reset=new Button(context); reset.setText("Reset view");reset.setAllCaps(false);reset.setTextSize(12);reset.setBackgroundColor(0xff171717); reset.setTextColor(Color.WHITE);
            addView(reset,new LayoutParams(-1,dp(42)));reset.setOnClickListener(v->plot.reset());
        }
        TextView hint=text(chart ? "Tap a value to inspect" : "Drag to pan · pinch to zoom · drag points");
        hint.setTextSize(11);hint.setTextColor(Color.GRAY);addView(hint);
    }
    private TextView text(String value){TextView t=new TextView(getContext());t.setText(value);t.setTypeface(Typeface.createFromAsset(getContext().getAssets(),"fonts/geist_regular.ttf"));t.setTextColor(Color.rgb(250,250,250));return t;}
    private static String format(double n){return String.format(Locale.US,"%.3g",n);}
    static Expression compile(String formula,Map<String,Double> values){
        Set<String> names=new HashSet<>(values.keySet());names.add("x");
        Function[] custom={
            new Function("min",2){public double apply(double... a){return Math.min(a[0],a[1]);}},
            new Function("max",2){public double apply(double... a){return Math.max(a[0],a[1]);}},
            new Function("pow",2){public double apply(double... a){return Math.pow(a[0],a[1]);}},
            new Function("round",1){public double apply(double... a){return Math.round(a[0]);}},
            new Function("sign",1){public double apply(double... a){return Math.signum(a[0]);}},
            new Function("ln",1){public double apply(double... a){return Math.log(a[0]);}}
        };
        Expression e=new ExpressionBuilder(formula).variables(names).functions(custom).build();
        for(Map.Entry<String,Double> v:values.entrySet())e.setVariable(v.getKey(),v.getValue());
        return e;
    }
    static double evaluate(String formula,double x,Map<String,Double> values){return compile(formula,values).setVariable("x",x).evaluate();
    }
    private final class Plot extends View {
        final JSONObject spec;final boolean chart;final Map<String,Double> values=new HashMap<>();
        final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);double xmin=-6,xmax=6,ymin=-4,ymax=4;
        final int[] colors={0xff2563eb,0xffdc2626,0xff059669,0xffd97706,0xff7c3aed};
        float lastX,lastY; JSONObject dragging;String selected="";String error="";
        final ScaleGestureDetector scale;
        Plot(Context c,JSONObject s,boolean isChart) throws Exception {
            super(c);spec=s;chart=isChart;reset();
            setContentDescription(isChart?"Interactive chart":"Interactive graph");
            scale=new ScaleGestureDetector(c,new ScaleGestureDetector.SimpleOnScaleGestureListener(){
                @Override public boolean onScale(ScaleGestureDetector d){
                    double factor=Math.max(.5,Math.min(2,d.getScaleFactor()));
                    double cx=wx(d.getFocusX()),cy=wy(d.getFocusY());
                    xmin=cx+(xmin-cx)/factor;xmax=cx+(xmax-cx)/factor;
                    ymin=cy+(ymin-cy)/factor;ymax=cy+(ymax-cy)/factor;invalidate();return true;
                }
            });
        }
        void reset(){JSONArray b=spec.optJSONArray("bounds");if(b!=null&&b.length()==4){xmin=b.optDouble(0,-6);xmax=b.optDouble(1,6);ymin=b.optDouble(2,-4);ymax=b.optDouble(3,4);}
            else{xmin=-6;xmax=6;ymin=-4;ymax=4;}if(xmax<=xmin||ymax<=ymin){xmin=-6;xmax=6;ymin=-4;ymax=4;}invalidate();}
        float sx(double x){return dp(36)+(float)((x-xmin)/(xmax-xmin))*(getWidth()-dp(48));}
        float sy(double y){return getHeight()-dp(34)-(float)((y-ymin)/(ymax-ymin))*(getHeight()-dp(54));}
        double wx(float x){return xmin+(x-dp(36))/(getWidth()-dp(48))*(xmax-xmin);}
        double wy(float y){return ymin+(getHeight()-dp(34)-y)/(getHeight()-dp(54))*(ymax-ymin);}
        void color(JSONObject e,int i){try{p.setColor(Color.parseColor(e.optString("color")));}catch(Exception ignored){p.setColor(colors[i%colors.length]);}}
        void line(Canvas c,float x,float y,float xx,float yy){c.drawLine(x,y,xx,yy,p);}
        @Override protected void onDraw(Canvas c){super.onDraw(c);error="";p.setTextSize(dp(10));p.setStrokeWidth(dp(1));p.setStyle(Paint.Style.STROKE);
            if(chart){try{drawChart(c);}catch(Exception ex){error="Invalid chart: "+ex.getMessage();}}
            else {
                if(spec.optBoolean("grid",true)){
                    p.setColor(0xff292929);
                    double step=Math.pow(10,Math.floor(Math.log10((xmax-xmin)/8)));
                    step=Math.max(step,1e-9);
                    for(double x=Math.ceil(xmin/step)*step,n=0;x<=xmax&&n<100;x+=step,n++)line(c,sx(x),sy(ymin),sx(x),sy(ymax));
                    double ystep=Math.pow(10,Math.floor(Math.log10((ymax-ymin)/6)));ystep=Math.max(ystep,1e-9);
                    for(double y=Math.ceil(ymin/ystep)*ystep,n=0;y<=ymax&&n<100;y+=ystep,n++)line(c,sx(xmin),sy(y),sx(xmax),sy(y));
                }
                if(spec.optBoolean("axis",true)){p.setColor(0xff777777);line(c,sx(xmin),sy(0),sx(xmax),sy(0));line(c,sx(0),sy(ymin),sx(0),sy(ymax));}
                JSONArray es=spec.optJSONArray("elements");
                Map<String,JSONObject> points=new HashMap<>();
                if(es!=null)for(int i=0;i<es.length();i++){JSONObject e=es.optJSONObject(i);if(e!=null&&"point".equals(e.optString("type")))points.put(e.optString("name"),e);}
                int save=c.save();c.clipRect(dp(36),dp(20),getWidth()-dp(12),getHeight()-dp(34));
                if(es!=null)for(int i=0;i<es.length();i++){JSONObject e=es.optJSONObject(i);if(e==null||e.optBoolean("hidden"))continue;color(e,i);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(dp(2));
                    try{switch(e.optString("type")){
                    case "function": {
                        String fn=e.getString("fn");Path path=new Path();boolean started=false;float prev=0;
                        // Compile once per frame, then update only x for each sample.
                        Expression expr=compile(fn,values);
                        for(int j=0;j<=400;j++){double x=xmin+(xmax-xmin)*j/400,y;try{y=expr.setVariable("x",x).evaluate();}catch(ArithmeticException ex){started=false;continue;}float yy=sy(y),xx=sx(x);
                            if(!Double.isFinite(y)||Math.abs(yy)>getHeight()*20){started=false;continue;}
                            if(!started||Math.abs(yy-prev)>getHeight()){path.moveTo(xx,yy);started=true;}else path.lineTo(xx,yy);prev=yy;}
                        c.drawPath(path,p);break;}
                    case "point":p.setStyle(Paint.Style.FILL);c.drawCircle(sx(e.optDouble("x")),sy(e.optDouble("y")),dp(5),p);c.drawText(e.optString("name"),sx(e.optDouble("x"))+dp(7),sy(e.optDouble("y"))-dp(7),p);break;
                    case "line":{JSONObject a=points.get(e.optString("from")),b=points.get(e.optString("to"));if(a!=null&&b!=null){double ax=a.optDouble("x"),ay=a.optDouble("y"),dx=b.optDouble("x")-ax,dy=b.optDouble("y")-ay;line(c,sx(ax-dx*10000),sy(ay-dy*10000),sx(ax+dx*10000),sy(ay+dy*10000));}break;}
                    case "circle":{JSONObject center=points.get(e.optString("center"));if(center!=null){double radius=e.opt("radius") instanceof Number?e.optDouble("radius"):evaluate(e.optString("radius","1"),0,values);float xx=sx(center.optDouble("x")),yy=sy(center.optDouble("y")),rx=Math.abs(sx(radius)-sx(0)),ry=Math.abs(sy(radius)-sy(0));c.drawOval(xx-rx,yy-ry,xx+rx,yy+ry,p);}break;}
                    case "text":p.setStyle(Paint.Style.FILL);c.drawText(e.optString("text"),sx(e.optDouble("x")),sy(e.optDouble("y")),p);break;
                    }}catch(Exception ex){error="Expression: "+ex.getMessage();}
                }
                c.restoreToCount(save);p.setColor(0xffa3a3a3);p.setStyle(Paint.Style.FILL);c.drawText(format(xmin)+" … "+format(xmax),dp(36),getHeight()-dp(14),p);
            }
            if(!error.isEmpty()||!selected.isEmpty()){p.setStyle(Paint.Style.FILL);p.setColor(error.isEmpty()?Color.WHITE:0xfff87171);c.drawText(error.isEmpty()?selected:error,dp(8),dp(15),p);}
        }
        void drawChart(Canvas c)throws Exception{
            JSONArray series=spec.optJSONArray("series");if(series==null){series=new JSONArray().put(new JSONObject().put("name","Data").put("values",spec.optJSONArray("values")));}
            String type=spec.optString("type","bar");JSONArray labels=spec.optJSONArray("x");if(labels==null)labels=spec.optJSONArray("labels");
            if("pie".equals(type)||"donut".equals(type)){
                JSONArray vals=series.getJSONObject(0).getJSONArray("values");double total=0;for(int i=0;i<vals.length();i++)total+=Math.max(0,vals.getDouble(i));
                if(total<=0)throw new Exception("Positive total required");
                float size=Math.min(getWidth()-dp(40),getHeight()-dp(60)),left=(getWidth()-size)/2,top=dp(25),start=-90;
                for(int i=0;i<vals.length();i++){p.setColor(colors[i%colors.length]);p.setStyle(Paint.Style.FILL);float angle=(float)(Math.max(0,vals.getDouble(i))/total*360);c.drawArc(left,top,left+size,top+size,start,angle,true,p);start+=angle;}
                if("donut".equals(type)){p.setColor(0xff0e0e0e);c.drawCircle(getWidth()/2f,top+size/2,size*.3f,p);}
                return;
            }
            double lo=0,hi=0,xlo=Double.POSITIVE_INFINITY,xhi=Double.NEGATIVE_INFINITY;int n=1;
            boolean scatter="scatter".equals(type);
            for(int i=0;i<series.length();i++){JSONObject s=series.getJSONObject(i);JSONArray a=s.getJSONArray(scatter?"points":"values");n=Math.max(n,a.length());for(int j=0;j<a.length();j++){double y=scatter?a.getJSONArray(j).getDouble(1):a.getDouble(j);lo=Math.min(lo,y);hi=Math.max(hi,y);if(scatter){double x=a.getJSONArray(j).getDouble(0);xlo=Math.min(xlo,x);xhi=Math.max(xhi,x);}}}
            ymin=lo;ymax=hi==lo?lo+1:hi+(hi-lo)*.15;xmin=scatter?xlo-.5:-.5;xmax=scatter?xhi+.5:n-.5;
            p.setColor(0xff555555);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(dp(1));line(c,sx(xmin),sy(0),sx(xmax),sy(0));
            for(int i=0;i<series.length();i++){JSONObject s=series.getJSONObject(i);color(s,i);JSONArray a=s.getJSONArray(scatter?"points":"values");Path path=new Path();
                for(int j=0;j<a.length();j++){double x=scatter?a.getJSONArray(j).getDouble(0):j,y=scatter?a.getJSONArray(j).getDouble(1):a.getDouble(j);float xx=sx(x),yy=sy(y);p.setStyle(Paint.Style.FILL);
                    if("bar".equals(type)){float bw=(getWidth()-dp(48))/(float)n/(series.length()+1),left=xx-(series.length()*bw)/2+i*bw;c.drawRect(left,Math.min(yy,sy(0)),left+bw*.9f,Math.max(yy,sy(0)),p);}
                    else if(scatter)c.drawCircle(xx,yy,dp(4),p);else{if(j==0)path.moveTo(xx,yy);else path.lineTo(xx,yy);}
                }
                if("line".equals(type)||"area".equals(type)){p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(dp(2));c.drawPath(path,p);
                    if("area".equals(type)&&a.length()>0){path.lineTo(sx(a.length()-1),sy(0));path.lineTo(sx(0),sy(0));path.close();p.setStyle(Paint.Style.FILL);p.setAlpha(50);c.drawPath(path,p);p.setAlpha(255);}}
                p.setStyle(Paint.Style.FILL);c.drawText(s.optString("name","Series "+(i+1)),dp(36)+i*dp(85),getHeight()-dp(4),p);
            }
            p.setColor(0xffa3a3a3);p.setStyle(Paint.Style.FILL);
            if(labels!=null)for(int i=0;i<labels.length();i++){if(labels.length()>8&&i%((labels.length()+7)/8)!=0)continue;String l=labels.optString(i);c.drawText(l.substring(0,Math.min(9,l.length())),sx(i)-dp(10),getHeight()-dp(18),p);}
            c.drawText(format(ymax),0,dp(30),p);c.drawText(format(ymin),0,getHeight()-dp(34),p);
        }
        @Override public boolean onTouchEvent(MotionEvent e){
            getParent().requestDisallowInterceptTouchEvent(true);
            if(!chart)scale.onTouchEvent(e);
            if(e.getActionMasked()==MotionEvent.ACTION_DOWN){lastX=e.getX();lastY=e.getY();dragging=null;
                JSONArray es=spec.optJSONArray("elements");if(!chart&&es!=null)for(int i=0;i<es.length();i++){JSONObject item=es.optJSONObject(i);if(item!=null&&"point".equals(item.optString("type"))&&!item.optBoolean("fixed")&&Math.hypot(sx(item.optDouble("x"))-lastX,sy(item.optDouble("y"))-lastY)<dp(20)){dragging=item;break;}}
                if(chart){selected=valueAt(e.getX(),e.getY());setContentDescription("Interactive chart · "+selected);invalidate();}}
            if(!chart&&e.getActionMasked()==MotionEvent.ACTION_MOVE&&!scale.isInProgress()&&e.getPointerCount()==1){
                if(dragging!=null){try{dragging.put("x",wx(e.getX()));dragging.put("y",wy(e.getY()));}catch(Exception ignored){}}
                else{double dx=(e.getX()-lastX)/(getWidth()-dp(48))*(xmax-xmin),dy=(e.getY()-lastY)/(getHeight()-dp(54))*(ymax-ymin);xmin-=dx;xmax-=dx;ymin+=dy;ymax+=dy;}
                lastX=e.getX();lastY=e.getY();invalidate();}
            if(e.getActionMasked()==MotionEvent.ACTION_UP){performClick();getParent().requestDisallowInterceptTouchEvent(false);}return true;
        }
        String valueAt(float x,float y){
            try{JSONArray series=spec.getJSONArray("series");boolean pie=spec.optString("type").equals("pie")||spec.optString("type").equals("donut");JSONArray labels=spec.optJSONArray("x");if(labels==null)labels=spec.optJSONArray("labels");
                int best=0;double distance=Double.POSITIVE_INFINITY;String value="";
                for(int i=0;i<series.length();i++){JSONObject s=series.getJSONObject(i);JSONArray a=s.optJSONArray("values"),points=s.optJSONArray("points");
                    if(pie&&a!=null){double angle=(Math.toDegrees(Math.atan2(y-getHeight()/2f,x-getWidth()/2f))+450)%360,total=0,cum=0;for(int j=0;j<a.length();j++)total+=Math.max(0,a.getDouble(j));for(int j=0;j<a.length();j++){cum+=Math.max(0,a.getDouble(j))/total*360;if(angle<=cum){return (labels==null?""+j:labels.optString(j))+" = "+a.getDouble(j);}}}
                    int count=a==null?(points==null?0:points.length()):a.length();for(int j=0;j<count;j++){double xx=points==null?j:points.getJSONArray(j).getDouble(0),yy=points==null?a.getDouble(j):points.getJSONArray(j).getDouble(1),d=Math.hypot(sx(xx)-x,sy(yy)-y);if(d<distance){distance=d;best=j;value=s.optString("name")+": "+(labels==null?format(xx):labels.optString(best))+" = "+format(yy);}}
                }return value;
            }catch(Exception ignored){return "";}
        }
        @Override public boolean performClick(){super.performClick();return true;}
    }
}
