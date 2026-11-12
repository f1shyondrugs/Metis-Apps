import {mountOnboardingMotion,ONBOARDING_TIMING} from "./onboarding-motion.js";
const api=window.metisDesktop,byId=id=>document.getElementById(id),main=document.querySelector("main"),media=matchMedia("(prefers-reduced-motion: reduce)");
let current,pending,exitTimer=0,enterTimer=0,dispose;
function clearTransitions(){clearTimeout(exitTimer);clearTimeout(enterTimer);exitTimer=enterTimer=0;main.inert=false;main.dataset.transition="idle";}
function enter(){clearTimeout(enterTimer);main.inert=false;main.dataset.transition=media.matches?"idle":"in";if(!media.matches)enterTimer=setTimeout(()=>{main.dataset.transition="idle";enterTimer=0;},ONBOARDING_TIMING.sceneEnter);}
byId("motion").addEventListener("metis:onboarding-ready",()=>{document.body.dataset.onboardingReady="true";if(current?.mode!=="ready")enter();});
dispose=mountOnboardingMotion(byId("motion"));
function paint(state){
 const previous=current;current=state;
 if(state.mode==="ready"){dispose?.();dispose=null;}else if(!dispose)dispose=mountOnboardingMotion(byId("motion"));
 byId("welcome").hidden=state.mode!=="welcome";byId("form").hidden=state.mode!=="settings";
 byId("actions").hidden=!["loading","error"].includes(state.mode);byId("retry").hidden=state.mode==="loading";
 byId("server-label").textContent=state.mode==="welcome"?"":state.server;
 byId("heading").textContent=state.mode==="welcome"?"Welcome to Metis.":state.mode==="settings"?"Connect to your Metis.":state.mode==="error"?"Connection interrupted.":"Opening your workspace.";
 byId("description").textContent=state.mode==="welcome"?"Connect. Sign in. Make it yours.":state.mode==="settings"?"Enter your Metis server address.":state.mode==="error"?state.message:"Sign-in or first-time setup opens next.";
 byId("back").textContent="Back";
 for(const li of document.querySelectorAll("#progress li")){li.removeAttribute("aria-current");if(li.dataset.step===(["error","ready"].includes(state.mode)?"loading":state.mode))li.setAttribute("aria-current","step");}
 if(state.mode==="settings"&&previous?.mode!=="settings"){byId("server").value=state.server;byId("validation").textContent="";byId("server").focus();}
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
api.onState(render);api.state().then(render);
byId("begin").addEventListener("click",()=>api.settings());
byId("back").addEventListener("click",()=>current?.firstRun?api.welcome():api.retry());
byId("retry").addEventListener("click",()=>api.retry());byId("settings").addEventListener("click",()=>api.settings());
byId("form").addEventListener("submit",async event=>{
 event.preventDefault();if(main.inert)return;const button=byId("form").querySelector('button[type="submit"]');button.disabled=true;
 try{const result=await api.connect(byId("server").value);if(!result.ok)byId("validation").textContent=result.error;}
 catch{byId("validation").textContent="The address could not be saved. Try again.";}
 finally{button.disabled=false;}
});
