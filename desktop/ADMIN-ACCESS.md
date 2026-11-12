# Windows desktop and background device access

The desktop app runs as the signed-in **Standard user**. An Administrator pairing starts a separate elevated **Metis Device Connection** process through ordinary Windows UAC. It has no window or tray. Only the normal desktop process owns the shared **Metis** tray, desktop windows, assistant and notifications.

Enter an Administrator pairing code in **Remote Client Device Settings** and confirm UAC. You can also use **Enable Administrator Remote Client** before pairing. Cancelling leaves the normal app and any current User connection unchanged; it does not consume the code. The elevated device utility independently verifies its actual token before loading remote commands. An existing User pairing is never silently upgraded.

Closing either window with X hides it. Device commands and notifications continue in the background. **Open Metis** or **Open Remote Client Device Settings** in the one tray reopens the relevant window without another UAC prompt. **Quit** stops both processes. Loss of the private desktop channel also stops the elevated host, so crashes cannot leave an uncontrolled elevated client.

Launching the desktop shortcut with Run as administrator redirects the UI to the same OS account/session's verified normal shell token. This does not change a pairing grant or skip the separate device consent. If the interactive shell is unavailable or belongs to another account/session, launch fails rather than keeping an elevated web UI. Autostart of the UI uses Limited rights; an admin-paired cold start can request device UAC once, and cancellation leaves the desktop usable with an explicit retry.

## Local boundary

Only fixed executable/role arguments and a random pipe nonce plus parent PID are passed through RunAs. No credentials, URLs, commands or pairing codes are in arguments. The native pipe uses FIRST_PIPE_INSTANCE and rejects remote clients. Both endpoints check kernel-supplied peer PID, SID, session, elevation and exact current executable before accepting any payload. The elevated client uses SECURITY_IDENTIFICATION SQOS so the normal pipe server cannot impersonate its admin token. Frames and queues are bounded; transport work stays off the UI thread. The fixed protocol can start/stop the device runtime, update presentation capabilities, cancel computer use and acknowledge events; it has no arbitrary local shell/file/launch operation.

Pairing data is sent only in memory to that verified child. Existing OS-encrypted credential storage and server-side access grants remain authoritative. Main-frame/local-file guards cover the UI action; remote web frames cannot start elevation. No global UAC setting, privileged scheduled task, firewall rule or existing grant is altered to make this work.

Tests distinguish real token/pipe integration from simulated UAC cancellation. A user's secure-desktop approval is never automated.
