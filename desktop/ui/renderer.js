import {mountOnboardingMotion,ONBOARDING_TIMING} from "./onboarding-motion.js";
const replay=window.metisOnboardingReplay,api=window.metisDesktop,byId=id=>document.getElementById(id),main=document.querySelector("main"),media=matchMedia("(prefers-reduced-motion: reduce)");
let current,pending,exitTimer=0,enterTimer=0,dispose;
function clearTransitions(){clearTimeout(exitTimer);clearTimeout(enterTimer);exitTimer=enterTimer=0;main.inert=false;main.dataset.transition="idle";}
function enter(){clearTimeout(enterTimer);main.inert=false;main.dataset.transition=media.matches?"idle":"in";if(!media.matches)enterTimer=setTimeout(()=>{main.dataset.transition="idle";enterTimer=0;},current?.mode==="welcome"?ONBOARDING_TIMING.welcomeEnter:ONBOARDING_TIMING.sceneEnter);}
byId("motion").addEventListener("metis:onboarding-ready",()=>{document.body.dataset.onboardingReady="true";if(current?.mode!=="ready")enter();});
dispose=mountOnboardingMotion(byId("motion"));
function paint(state){
 const previous=current;current=state;document.body.dataset.mode=state.mode;
 if(state.mode==="ready"){dispose?.();dispose=null;}else if(!dispose)dispose=mountOnboardingMotion(byId("motion"));
 byId("welcome").hidden=state.mode!=="welcome";byId("form").hidden=state.mode!=="settings";byId("form-buttons").hidden=state.mode!=="settings";
 byId("exit-replay").hidden=!replay;byId("replay-actions").hidden=!replay||state.mode!=="loading";
 byId("actions").hidden=Boolean(replay)||!["loading","error"].includes(state.mode);byId("retry").hidden=state.mode==="loading";
 byId("server-label").textContent=state.mode==="welcome"?"":(state.server??"");
 byId("heading").textContent=state.mode==="welcome"?"Welcome to Metis":state.mode==="settings"?"Connect to your Metis.":state.mode==="error"?"Connection interrupted.":"Opening your workspace.";
 byId("description").textContent=state.mode==="welcome"?"Your workspace. Your way.":state.mode==="settings"?"Enter your Metis server address.":state.mode==="error"?state.message:"Sign-in or first-time setup opens next.";
 if(replay){
  byId("server").readOnly=true;
  byId("server-hint").textContent="Your current server will not change.";
  byId("description").textContent=state.mode==="welcome"?"Replay desktop setup without changing your workspace.":state.mode==="settings"?"Review your current Metis server address.":"Sign-in or first-time setup normally opens here. Your existing workspace stays open.";
  if(state.mode==="loading"){byId("heading").textContent="Your Metis workspace.";byId("finish-replay").focus();}
  if(state.mode==="welcome")byId("begin").focus();
 }
 for(const li of document.querySelectorAll("#progress li")){li.removeAttribute("aria-current");if(li.dataset.step===(["error","ready"].includes(state.mode)?"loading":state.mode))li.setAttribute("aria-current","step");}
 if(state.mode==="settings"&&previous?.mode!=="settings"){byId("server").value=state.server??"";byId("validation").textContent="";byId("server").focus();}
}
function render(state){
 pending=state;
 if(!current||state.mode==="ready"||current.mode==="ready"||media.matches||document.body.dataset.onboardingReady!=="true"){clearTransitions();paint(state);if(state.mode!=="ready"&&document.body.dataset.onboardingReady==="true")enter();return;}
 if(state.mode===current.mode&&!exitTimer){paint(state);return;}
 if(exitTimer)return;
 clearTimeout(enterTimer);main.dataset.transition="out";main.inert=true;
 exitTimer=setTimeout(()=>{exitTimer=0;main.inert=false;paint(pending);enter();},ONBOARDING_TIMING.sceneExit);
}
const motionChanged=()=>{if(media.matches){clearTransitions();if(pending)paint(pending);}};
media.addEventListener("change",motionChanged);
addEventListener("pagehide",()=>{clearTransitions();dispose?.();media.removeEventListener("change",motionChanged);},{once:true});
if(replay){
 replay.state().then(server=>render({mode:"welcome",server}));
 byId("exit-replay").addEventListener("click",()=>replay.close());
 byId("finish-replay").addEventListener("click",()=>replay.close());
 byId("replay-back").addEventListener("click",()=>render({...current,mode:"settings"}));
 window.addEventListener("keydown",event=>{if(event.key==="Escape")replay.close();});
}else{api.onState(render);api.state().then(render);}
byId("begin").addEventListener("click",()=>replay?(current&&render({...current,mode:"settings"})):api.settings());
byId("back").addEventListener("click",()=>replay?render({...current,mode:"welcome"}):current?.firstRun?api.welcome():api.retry());
byId("retry").addEventListener("click",()=>api.retry());byId("settings").addEventListener("click",()=>api.settings());
byId("form").addEventListener("submit",async event=>{
 event.preventDefault();if(main.inert)return;
 if(replay){if(current?.mode==="settings")render({...current,mode:"loading"});return;}
 const button=byId("connect");button.disabled=true;
 try{const result=await api.connect(byId("server").value);if(!result.ok)byId("validation").textContent=result.error;}
 catch{byId("validation").textContent="The address could not be saved. Try again.";}
 finally{button.disabled=false;}
});
