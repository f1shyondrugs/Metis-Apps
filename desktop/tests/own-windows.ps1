# Enumerate only windows of the isolated process under test. Process.MainWindow
# can pick a transient/owned HWND on a fresh frameless Electron launch.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class MetisOwnWindows {
  delegate bool Callback(IntPtr window,IntPtr value);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr value);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder text,int count);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr w,IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
  static bool IsWorkspace(IntPtr window,int process) {
    uint owner;GetWindowThreadProcessId(window,out owner);
    if(owner!=(uint)process||!IsWindowVisible(window))return false;
    var title=new StringBuilder(512);var type=new StringBuilder(256);Rect rect;
    GetWindowText(window,title,512);GetClassName(window,type,256);GetWindowRect(window,out rect);
    return title.ToString()=="Metis"&&type.ToString().StartsWith("Chrome_WidgetWin")&&rect.Right-rect.Left>=390&&rect.Bottom-rect.Top>=400;
  }
  public static long Find(int process) {
    long found=0;
    EnumWindows(delegate(IntPtr window,IntPtr value){
      if(IsWorkspace(window,process)){found=window.ToInt64();return false;}return true;
    },IntPtr.Zero);
    return found;
  }
  public static int Count(int process) {
    int count=0;
    EnumWindows(delegate(IntPtr window,IntPtr value){if(IsWorkspace(window,process))count++;return true;},IntPtr.Zero);
    return count;
  }
  public static string Describe(int process) {
    var lines=new List<string>();
    EnumWindows(delegate(IntPtr window,IntPtr value){
      uint owner;GetWindowThreadProcessId(window,out owner);if(owner!=(uint)process)return true;
      var title=new StringBuilder(512);var type=new StringBuilder(256);
      GetWindowText(window,title,512);GetClassName(window,type,256);
      lines.Add(window.ToInt64()+" visible="+IsWindowVisible(window)+" class="+type+" title="+title);return true;
    },IntPtr.Zero);
    return String.Join("\n",lines.ToArray());
  }
  public static bool Close(int process,long handle) {
    uint owner;GetWindowThreadProcessId(new IntPtr(handle),out owner);
    return owner==(uint)process&&PostMessage(new IntPtr(handle),0x10,IntPtr.Zero,IntPtr.Zero);
  }
}
'@
