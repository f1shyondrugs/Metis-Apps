import {mountOnboardingMotion} from "./onboarding-motion.js";
const api=window.metisDesktop,byId=id=>document.getElementById(id);
let dispose=mountOnboardingMotion(byId("motion"));addEventListener("pagehide",()=>dispose?.(),{once:true});
let current;
function render(state){
 const previous=current;current=state;
 if(state.mode==="ready"){dispose?.();dispose=null;}else if(!dispose)dispose=mountOnboardingMotion(byId("motion"));
 byId("welcome").hidden=state.mode!=="welcome";
 byId("form").hidden=state.mode!=="settings";
 byId("actions").hidden=!["loading","error"].includes(state.mode);
 byId("retry").hidden=state.mode==="loading";
 byId("server-label").textContent=state.mode==="welcome"?"":state.server;
 byId("heading").textContent=state.mode==="welcome"?"Welcome to Metis.":state.mode==="settings"?"Connect to your Metis.":state.mode==="error"?"Connection interrupted.":"Opening your workspace.";
 byId("description").textContent=state.mode==="welcome"?"A short setup for this desktop. Connect your server, sign in and choose the features you want.":state.mode==="settings"?"Enter the domain of your Metis installation. We will open sign-in or, for a fresh server, its first-time setup.":state.mode==="error"?state.message:"The next step is provided by your server: sign in, or create the first account if the installation is new.";
 byId("back").textContent=state.firstRun?"Back":"Cancel";
 for(const li of document.querySelectorAll("#progress li")){li.removeAttribute("aria-current");if(li.dataset.step===(["error","ready"].includes(state.mode)?"loading":state.mode))li.setAttribute("aria-current","step");}
 if(state.mode==="settings"&&previous?.mode!=="settings"){byId("server").value=state.server;byId("validation").textContent="";byId("server").focus();}
}
api.onState(render);api.state().then(render);
byId("begin").addEventListener("click",()=>api.settings());
byId("back").addEventListener("click",()=>current?.firstRun?api.welcome():api.retry());
byId("retry").addEventListener("click",()=>api.retry());byId("settings").addEventListener("click",()=>api.settings());
byId("form").addEventListener("submit",async event=>{
 event.preventDefault();const button=byId("form").querySelector('button[type="submit"]');button.disabled=true;
 try{const result=await api.connect(byId("server").value);if(!result.ok)byId("validation").textContent=result.error;}
 catch{byId("validation").textContent="The address could not be saved. Try again.";}
 finally{button.disabled=false;}
});
