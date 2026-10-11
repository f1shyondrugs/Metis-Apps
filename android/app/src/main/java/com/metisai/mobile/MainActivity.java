package com.metisai.mobile;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.drawable.ColorDrawable;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ImageView;
import android.widget.PopupMenu;
import android.app.AlertDialog;
import android.text.TextUtils;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import io.noties.markwon.Markwon;
import io.noties.markwon.ext.tables.TablePlugin;
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;
import java.util.StringJoiner;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String SERVER = "server_url";
    private static final String SESSION = "session_cookie";
    private static final String USERNAME = "username";
    // Match the Metis web client's neutral dark theme.
    private static final int BG = Color.rgb(7, 7, 7);
    private static final int FG = Color.rgb(250, 250, 250);
    private static final int MUTED = Color.rgb(163, 163, 163);
    private static final int SURFACE = Color.rgb(14, 14, 14);
    private static final int SECONDARY = Color.rgb(38, 38, 38);
    private static final int BORDER = Color.rgb(41, 41, 41);

    private final ExecutorService network = Executors.newFixedThreadPool(3);
    private String serverUrl = "";
    private String sessionCookie = "";
    private String currentUsername = "";
    private boolean incognitoMode = false;
    private String activeChatId = "";
    private String activeProjectId = "";
    private boolean showArchivedChats = false;
    private TextView contextFooter;
    private JSONObject usageSnapshot = new JSONObject();
    private JSONArray conversationMessages = new JSONArray();
    private JSONArray currentWorkspaces = new JSONArray();
    private String selectedAgentMode = "agent";
    private JSONObject currentSessionState = new JSONObject();
    private String displayedQuestionId = "";
    private String displayedApprovalId = "";
    private Typeface webRegular, webSemibold, webWordmark;
    private JSONArray sidebarProjects = new JSONArray();
    private JSONArray sidebarChats = new JSONArray();
    private Dialog sidebarDialog;
    private LinearLayout sidebarPanel;
    private float swipeDownX, swipeDownY;
    private boolean swipeIgnore;
    private LinearLayout sidebarList;
    private TextView liveAssistantText;
    private TextView liveStatus;
    private Button sendButton;
    private EditText composer;
    private TextView modelButton;
    private ImageView browserFrame;
    private EditText browserAddress;
    private TextView browserStatus;
    private int browserWidth=1280,browserHeight=720;
    private float browserTouchX,browserTouchY;
    private Markwon markdown;
    private NativeVoice voice;
    private JSONObject globalModelPreferences = new JSONObject();
    private JSONArray availableModels = new JSONArray();
    private String selectedModelId = "";
    private String selectedModelName = "Standardmodell";
    private boolean busyRun = false;
    private final ArrayList<Uri> pendingAttachments = new ArrayList<>();
    private static final int PICK_ATTACHMENTS = 4107;

    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
            swipeDownX = event.getX(); swipeDownY = event.getY();
            View touched = findTouchTarget((ViewGroup)getWindow().getDecorView(), event.getX(), event.getY());
            swipeIgnore = isSwipeIgnored(touched);
        } else if (event.getActionMasked() == MotionEvent.ACTION_POINTER_DOWN) {
            swipeIgnore = true;
        }
        boolean handled = super.dispatchTouchEvent(event);
        if (event.getActionMasked() == MotionEvent.ACTION_UP) {
            float dx = event.getX() - swipeDownX, dy = event.getY() - swipeDownY;
            boolean eligible = !swipeIgnore && Math.abs(dx) >= dp(64) && Math.abs(dx) >= Math.abs(dy) * 1.35f;
            swipeIgnore = false;
            if (eligible && (getWindow().getDecorView().getRootWindowInsets() == null ||
                    Build.VERSION.SDK_INT < 30 || !getWindow().getDecorView().getRootWindowInsets().isVisible(WindowInsets.Type.ime()))) {
                if (dx > 0) {
                    if (sidebarDialog == null || !sidebarDialog.isShowing()) openNavigation(null);
                } else if (!activeChatId.isEmpty()) openWorkspaces();
            }
        } else if (event.getActionMasked() == MotionEvent.ACTION_CANCEL) swipeIgnore = false;
        return handled;
    }

    private View findTouchTarget(ViewGroup parent, float x, float y) {
        for (int i = parent.getChildCount()-1; i >= 0; i--) {
            View child = parent.getChildAt(i);
            if (x < child.getLeft() || x >= child.getRight() || y < child.getTop() || y >= child.getBottom()) continue;
            if (child instanceof ViewGroup) {
                View nested = findTouchTarget((ViewGroup)child, x-child.getLeft(), y-child.getTop());
                if (nested != null) return nested;
            }
            return child;
        }
        return parent;
    }

    private boolean isSwipeIgnored(View view) {
        for (View current=view; current!=null; current=(current.getParent() instanceof View ? (View)current.getParent() : null)) {
            if (current instanceof EditText || current instanceof Button || current instanceof SeekBar || current instanceof NativeBoard || current.isClickable()) return true;
            if (current instanceof TextView && ((TextView)current).isTextSelectable()) return true;
        }
        return false;
    }

    private int dp(float value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        webRegular = Typeface.createFromAsset(getAssets(), "fonts/geist_regular.ttf");
        webSemibold = Typeface.createFromAsset(getAssets(), "fonts/geist_semibold.ttf");
        webWordmark = Typeface.createFromAsset(getAssets(), "fonts/gfs_didot.ttf");
        markdown = Markwon.builder(this).usePlugin(TablePlugin.create(this)).usePlugin(StrikethroughPlugin.create()).build();
        serverUrl = getPreferences(MODE_PRIVATE).getString(SERVER, "");
        sessionCookie = getPreferences(MODE_PRIVATE).getString(SESSION, "");
        currentUsername = getPreferences(MODE_PRIVATE).getString(USERNAME, "");
        if (serverUrl.isEmpty()) {
            showServerSetup("");
        } else if (sessionCookie.isEmpty()) {
            showLogin("");
        } else {
            loadChatList();
        }
    }

    private void applySystemInsets(View root) {
        final int left = root.getPaddingLeft();
        final int top = root.getPaddingTop();
        final int right = root.getPaddingRight();
        final int bottom = root.getPaddingBottom();
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int insetLeft;
            int insetTop;
            int insetRight;
            int insetBottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                insetLeft = bars.left;
                insetTop = bars.top;
                insetRight = bars.right;
                insetBottom = Math.max(bars.bottom, ime.bottom);
            } else {
                insetLeft = insets.getSystemWindowInsetLeft();
                insetTop = insets.getSystemWindowInsetTop();
                insetRight = insets.getSystemWindowInsetRight();
                insetBottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(left + insetLeft, top + insetTop, right + insetRight, bottom + insetBottom);
            return insets;
        });
        root.post(root::requestApplyInsets);
    }

    private LinearLayout page() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        applySystemInsets(root);
        return root;
    }

    private TextView label(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setIncludeFontPadding(false);
        if (webRegular != null) view.setTypeface(webRegular);
        return view;
    }

    private Button button(String title) {
        Button result = new Button(this);
        result.setText(title);
        result.setTextColor(Color.rgb(28, 28, 28));
        result.setTextSize(14);
        result.setTypeface(webSemibold);
        result.setAllCaps(false);
        result.setMinHeight(dp(42));
        result.setMinWidth(0);
        result.setPadding(dp(16), 0, dp(16), 0);
        result.setBackground(background(FG, dp(9)));
        result.setElevation(0);
        result.setStateListAnimator(null);
        return result;
    }

    private EditText input(String hint, boolean secret) {
        EditText edit = new EditText(this);
        edit.setTypeface(webRegular);
        edit.setSingleLine(!secret);
        edit.setHint(hint);
        edit.setTextColor(FG);
        edit.setHintTextColor(Color.rgb(125, 125, 125));
        edit.setTextSize(15);
        edit.setPadding(dp(14), dp(12), dp(14), dp(12));
        edit.setBackground(outlinedSurface(SURFACE, dp(9)));
        if (secret) edit.setInputType(129);
        return edit;
    }

    private void header(LinearLayout root, String title, String action, View.OnClickListener listener) {
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(18), 0, dp(10), 0);
        if ("Metis".equals(title)) {
            LinearLayout brand = new LinearLayout(this);
            brand.setGravity(Gravity.CENTER_VERTICAL);
            ImageView leftHand = new ImageView(this);
            leftHand.setImageResource(R.drawable.hand_left);
            leftHand.setScaleType(ImageView.ScaleType.FIT_CENTER);
            brand.addView(leftHand, new LinearLayout.LayoutParams(dp(26), dp(22)));
            TextView heading = label("Μῆτις", 19, FG);
            heading.setTypeface(Typeface.create("serif", Typeface.ITALIC));
            heading.setLetterSpacing(-0.025f);
            LinearLayout.LayoutParams brandText = new LinearLayout.LayoutParams(-2, dp(52));
            brandText.leftMargin = dp(3);
            brand.addView(heading, brandText);
            ImageView rightHand = new ImageView(this);
            rightHand.setImageResource(R.drawable.hand_right);
            rightHand.setScaleType(ImageView.ScaleType.FIT_CENTER);
            LinearLayout.LayoutParams rightHandParams = new LinearLayout.LayoutParams(dp(26), dp(22));
            rightHandParams.leftMargin = dp(3);
            brand.addView(rightHand, rightHandParams);
            bar.addView(brand, new LinearLayout.LayoutParams(0, dp(56), 1));
        } else {
            TextView heading = label(title, 19, FG);
            heading.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            heading.setLetterSpacing(-0.025f);
            bar.addView(heading, new LinearLayout.LayoutParams(0, dp(56), 1));
        }
        if (action != null) {
            TextView button = label(action, 13, MUTED);
            button.setGravity(Gravity.CENTER);
            button.setPadding(dp(12), 0, dp(12), 0);
            button.setOnClickListener(listener);
            bar.addView(button, new LinearLayout.LayoutParams(-2, dp(48)));
        }
        root.addView(bar, new LinearLayout.LayoutParams(-1, dp(56)));
        View divider = new View(this);
        divider.setBackgroundColor(BORDER);
        root.addView(divider, new LinearLayout.LayoutParams(-1, dp(1)));
    }

    private LinearLayout centeredForm() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setGravity(Gravity.CENTER);
        form.setPadding(dp(16), 0, dp(16), 0);
        form.setBackgroundColor(Color.TRANSPARENT);
        return form;
    }

    private TextView wordmark() {
        TextView brand = label("Μῆτις", 22, FG);
        brand.setTypeface(Typeface.create(webWordmark, Typeface.ITALIC));
        brand.setLetterSpacing(-0.055f);
        return brand;
    }

    private void showServerSetup(String previous) {
        LinearLayout root = page();
        LinearLayout form = centeredForm();
        form.addView(wordmark());
        TextView title = label("Mit deinem Server verbinden", 22, FG);
        title.setPadding(0, dp(26), 0, dp(8));
        form.addView(title);
        TextView hint = label("Gib die Adresse deiner Metis-Instanz ein. Danach meldest du dich mit deinem Konto an.", 15, MUTED);
        form.addView(hint);
        EditText address = input("https://metis.example.com", false);
        address.setSingleLine(true);
        address.setInputType(17);
        address.setText(previous);
        LinearLayout.LayoutParams addressParams = new LinearLayout.LayoutParams(-1, -2);
        addressParams.topMargin = dp(22);
        form.addView(address, addressParams);
        Button connect = button("Weiter");
        LinearLayout.LayoutParams connectParams = new LinearLayout.LayoutParams(-1, -2);
        connectParams.topMargin = dp(14);
        form.addView(connect, connectParams);
        TextView foot = label("Die Serveradresse bleibt auf diesem Gerät gespeichert.", 13, MUTED);
        foot.setPadding(0, dp(16), 0, 0);
        form.addView(foot);
        connect.setOnClickListener(v -> {
            String value = address.getText().toString().trim();
            if (value.isEmpty()) {
                address.setError("Serveradresse erforderlich");
                return;
            }
            if (!value.matches("(?i)^https?://.*")) value = "https://" + value;
            Uri uri = Uri.parse(value);
            if (uri.getHost() == null || uri.getUserInfo() != null) {
                address.setError("Bitte eine gültige Serveradresse eingeben");
                return;
            }
            value = uri.buildUpon().fragment(null).build().toString();
            while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
            serverUrl = value;
            sessionCookie = "";
            getPreferences(MODE_PRIVATE).edit().putString(SERVER, serverUrl).remove(SESSION).apply();
            showLogin("");
        });
        LinearLayout.LayoutParams formParams = new LinearLayout.LayoutParams(-1, 0, 1);
        formParams.setMargins(dp(18), dp(18), dp(18), dp(18));
        root.addView(form, formParams);
        setContentView(root);
    }

    private void showLogin(String error) {
        LinearLayout root = page();
        LinearLayout form = centeredForm();
        form.setTranslationY(-dp(28));
        TextView title = label("Sign in", 16, FG);
        title.setGravity(Gravity.CENTER);
        form.addView(title);
        TextView subtitle = label("Password", 14, MUTED);
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(-1, -2);
        subtitleParams.topMargin = dp(8);
        form.addView(subtitle, subtitleParams);
        EditText username = input("Username", false);
        EditText password = input("Password", true);
        LinearLayout.LayoutParams field = new LinearLayout.LayoutParams(-1, dp(40));
        field.topMargin = dp(16);
        form.addView(username, field);
        LinearLayout.LayoutParams second = new LinearLayout.LayoutParams(-1, dp(40));
        second.topMargin = dp(10);
        form.addView(password, second);
        TextView message = label(error, 12, Color.rgb(255, 120, 120));
        message.setGravity(Gravity.CENTER);
        message.setPadding(0, dp(8), 0, 0);
        if (!error.isEmpty()) form.addView(message);
        Button login = button("Continue");
        login.setBackground(background(FG, dp(12)));
        LinearLayout.LayoutParams loginParams = new LinearLayout.LayoutParams(-1, dp(40));
        loginParams.topMargin = dp(14);
        form.addView(login, loginParams);
        TextView change = label("Change server", 12, MUTED);
        change.setGravity(Gravity.CENTER);
        change.setPadding(0, dp(12), 0, 0);
        change.setOnClickListener(v -> showServerSetup(serverUrl));
        form.addView(change);
        login.setOnClickListener(v -> {
            String user = username.getText().toString().trim();
            String pass = password.getText().toString();
            if (user.isEmpty() || pass.isEmpty()) {
                message.setText("Enter your username and password.");
                return;
            }
            login.setEnabled(false);
            message.setText("Signing in …");
            network.execute(() -> {
                try {
                    HttpURLConnection connection = openConnection("/api/auth", "POST", null);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json");
                    JSONObject body = new JSONObject();
                    body.put("username", user);
                    body.put("password", pass);
                    writeBody(connection, body.toString());
                    int code = connection.getResponseCode();
                    String response = readResponse(connection, code);
                    String setCookie = connection.getHeaderField("Set-Cookie");
                    connection.disconnect();
                    if (code < 200 || code >= 300) throw apiError(response, code);
                    if (setCookie == null || !setCookie.contains("=")) {
                        throw new Exception("The server did not return a session.");
                    }
                    sessionCookie = setCookie.split(";", 2)[0].trim();
                    currentUsername = user;
                    getPreferences(MODE_PRIVATE).edit().putString(SESSION, sessionCookie).putString(USERNAME, user).apply();
                    JSONObject chatsResponse = requestJson("/api/chats", "GET", null);
                    runOnUiThread(this::showChatList);
                } catch (Exception ex) {
                    runOnUiThread(() -> {
                        login.setEnabled(true);
                        message.setText(messageFor(ex));
                    });
                }
            });
        });
        LinearLayout.LayoutParams formParams = new LinearLayout.LayoutParams(-1, 0, 1);
        formParams.setMargins(dp(18), dp(18), dp(18), dp(18));
        root.addView(form, formParams);
        setContentView(root);
    }

    private void loadChatList() {
        network.execute(() -> {
            try {
                JSONObject response = requestJson("/api/chats" + (showArchivedChats ? "?includeArchived=true" : ""), "GET", null);
                loadModels();
                JSONArray chats = response.optJSONArray("chats");
                runOnUiThread(() -> showChatList(chats == null ? new JSONArray() : chats));
            } catch (Exception ex) {
                runOnUiThread(() -> {
                    if (isUnauthorized(ex)) showLogin("Bitte melde dich erneut an.");
                    else showLogin(messageFor(ex));
                });
            }
        });
    }


    private ImageView icon(String name, String description, int size) {
        ImageView view = new ImageView(this);
        int resource = getResources().getIdentifier("ic_" + name, "drawable", getPackageName());
        if (resource != 0) view.setImageResource(resource);
        view.setColorFilter(FG);
        view.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        view.setContentDescription(description);
        int pad = dp((44 - size) / 2f);
        view.setPadding(pad, pad, pad, pad);
        return view;
    }

    private LinearLayout navRow(String name, String title, Runnable action) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(6), 0, dp(8), 0);
        ImageView glyph = icon(name, "", 14);
        glyph.setPadding(0, 0, 0, 0);
        glyph.setColorFilter(MUTED);
        LinearLayout.LayoutParams glyphParams = new LinearLayout.LayoutParams(dp(14), dp(14));
        glyphParams.leftMargin = dp(8);
        glyphParams.rightMargin = dp(8);
        row.addView(glyph, glyphParams);
        row.setMinimumHeight(dp(36));
        row.addView(label(title, 13, MUTED), new LinearLayout.LayoutParams(0, -2, 1));
        row.setBackground(new android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(SECONDARY), null, null));
        row.setOnClickListener(v -> { dismissSidebar(); action.run(); });
        row.setContentDescription(title);
        return row;
    }

    private void dismissSidebar() {
        final Dialog target=sidebarDialog; final LinearLayout panel=sidebarPanel;
        if(target==null||!target.isShowing())return;
        if(panel==null){target.dismiss();return;}
        panel.animate().translationX(-panel.getWidth()).setDuration(170).withEndAction(()->{if(target==sidebarDialog)target.dismiss();}).start();
    }

    private void openNavigation(View anchor) {
        if (sidebarDialog != null && sidebarDialog.isShowing()) return;
        Dialog dialog = new Dialog(this);
        sidebarDialog = dialog;
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.argb(51, 0, 0, 0));
        overlay.setOnClickListener(v -> dismissSidebar());
        final float[] drawerSwipe = new float[2];
        overlay.setOnTouchListener((view,event) -> {
            if(event.getActionMasked()==MotionEvent.ACTION_DOWN){drawerSwipe[0]=event.getX();drawerSwipe[1]=event.getY();}
            if(event.getActionMasked()==MotionEvent.ACTION_UP){float dx=event.getX()-drawerSwipe[0],dy=event.getY()-drawerSwipe[1];
                if(dx < -dp(64) && Math.abs(dx)>=Math.abs(dy)*1.35f){dismissSidebar();return true;}}
            return false;
        });
        LinearLayout panel = new LinearLayout(this);
        sidebarPanel = panel;
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(SURFACE);
        panel.setOnClickListener(v -> {});
        applySystemInsets(panel);
        int width = Math.min(dp(320), getResources().getDisplayMetrics().widthPixels - dp(44));
        overlay.addView(panel, new FrameLayout.LayoutParams(width, -1, Gravity.LEFT));
        FrameLayout brand = new FrameLayout(this);
        brand.addView(wordmark(), new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        for (boolean left : new boolean[]{true, false}) {
            ImageView hand = new ImageView(this);
            hand.setImageResource(left ? R.drawable.hand_left : R.drawable.hand_right);
            hand.setScaleType(ImageView.ScaleType.FIT_CENTER);
            brand.addView(hand, new FrameLayout.LayoutParams(dp(80), dp(36),
                (left ? Gravity.LEFT : Gravity.RIGHT) | Gravity.CENTER_VERTICAL));
        }
        LinearLayout.LayoutParams brandParams = new LinearLayout.LayoutParams(-1, dp(58));
        brandParams.topMargin = dp(16);
        panel.addView(brand, brandParams);
        panel.addView(navRow("plus", "New chat", () -> createChat(button("New chat"))));
        panel.addView(navRow("search", "Search chats", this::showSearch));
        panel.addView(navRow("sticky_note", "Shared notes", this::loadNotes));
        panel.addView(navRow("calendar_clock", "Automations", this::loadAutomations));
        panel.addView(navRow("globe", "Browser", this::openBrowser));
        panel.addView(navRow("brain", "Memories", this::loadMemories));
        panel.addView(navRow("sparkles", "Skills", this::loadSkills));
        panel.addView(navRow("settings", "Settings", this::showSettings));
        ScrollView scroll = new ScrollView(this);
        sidebarList = new LinearLayout(this);
        sidebarList.setOrientation(LinearLayout.VERTICAL);
        sidebarList.setPadding(dp(8), dp(4), dp(8), dp(12));
        scroll.addView(sidebarList);
        panel.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        renderSidebar(sidebarChats);

        panel.addView(navRow("archive", showArchivedChats ? "Active chats" : "Archived chats", () -> {
            showArchivedChats = !showArchivedChats; openNavigation(anchor);
        }));
        panel.addView(navRow("log_out", currentUsername.isEmpty() ? "Sign out" : currentUsername + " · Sign out",
            () -> new AlertDialog.Builder(this).setTitle("Sign out?")
                .setNegativeButton("Cancel", null).setPositiveButton("Sign out", (d, w) -> logout()).show()));
        dialog.setContentView(overlay);
        dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        dialog.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        if (Build.VERSION.SDK_INT >= 30) dialog.getWindow().setDecorFitsSystemWindows(false);
        dialog.show();
        dialog.getWindow().setLayout(-1, -1);
        panel.setTranslationX(-width);
        panel.animate().translationX(0).setDuration(200).start();
        refreshSidebar();
    }

    private void refreshSidebar() {
        final Dialog target = sidebarDialog;
        final LinearLayout list = sidebarList;
        if (sidebarChats.length() == 0) {
            list.removeAllViews(); list.addView(label("Loading chats…", 13, MUTED));
        }
        network.execute(() -> {
            try {
                JSONArray chats = requestJson("/api/chats" + (showArchivedChats ? "?includeArchived=true" : ""),
                    "GET", null).optJSONArray("chats");
                JSONArray projects = requestJson("/api/projects", "GET", null).optJSONArray("projects");
                runOnUiThread(() -> {
                    if (target != sidebarDialog || !target.isShowing()) return;
                    sidebarProjects = projects == null ? new JSONArray() : projects;
                    sidebarChats = chats == null ? new JSONArray() : chats;
                    renderSidebar(sidebarChats);
                });
            } catch (Exception ex) {
                runOnUiThread(() -> {
                    if (target != sidebarDialog || !target.isShowing()) return;
                    list.removeAllViews(); list.addView(label(messageFor(ex), 13, MUTED));
                    TextView retry = label("Retry", 14, FG);
                    retry.setPadding(dp(8), dp(12), dp(8), dp(12));
                    retry.setOnClickListener(v -> refreshSidebar()); list.addView(retry);
                });
            }
        });
    }

    private void renderSidebar(JSONArray chats) {
        sidebarList.removeAllViews();
        LinearLayout section = new LinearLayout(this);
        section.setGravity(Gravity.CENTER_VERTICAL);
        TextView projectHeading = label("PROJECTS", 10, MUTED);
        projectHeading.setLetterSpacing(0.07f);
        projectHeading.setPadding(dp(10), dp(12), 0, dp(8));
        section.addView(projectHeading, new LinearLayout.LayoutParams(0, -2, 1));
        ImageView projectAction = icon("folder", "Manage projects", 14);
        section.addView(projectAction, new LinearLayout.LayoutParams(dp(40), dp(40)));
        projectAction.setOnClickListener(v -> { dismissSidebar(); loadProjects(); });
        sidebarList.addView(section);
        LinearLayout chipRow = null;
        int remaining = 0;
        int available = Math.min(dp(320), getResources().getDisplayMetrics().widthPixels - dp(44)) - dp(24);
        for (int i = -1; i < sidebarProjects.length(); i++) {
            JSONObject project = i < 0 ? null : sidebarProjects.optJSONObject(i);
            if (i >= 0 && project == null) continue;
            String id = project == null ? "" : project.optString("id");
            TextView chip = label(project == null ? "All" : project.optString("name"), 12, id.equals(activeProjectId) ? FG : MUTED);
            chip.setSingleLine(true); chip.setEllipsize(TextUtils.TruncateAt.END);
            chip.setGravity(Gravity.CENTER);
            chip.setPadding(dp(10), 0, dp(10), 0);
            chip.setBackground(background(id.equals(activeProjectId) ? SECONDARY : Color.rgb(20,20,20), dp(999)));
            chip.measure(View.MeasureSpec.makeMeasureSpec(available, View.MeasureSpec.AT_MOST),
                View.MeasureSpec.makeMeasureSpec(dp(28), View.MeasureSpec.EXACTLY));
            int width = Math.min(available, chip.getMeasuredWidth());
            if (chipRow == null || remaining < width + dp(6)) {
                chipRow = new LinearLayout(this);
                LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(-1, dp(32));
                rowParams.bottomMargin = dp(4); sidebarList.addView(chipRow, rowParams); remaining = available;
            }
            LinearLayout.LayoutParams chipParams = new LinearLayout.LayoutParams(width, dp(28));
            chipParams.rightMargin = dp(6); chipRow.addView(chip, chipParams); remaining -= width + dp(6);
            chip.setOnClickListener(v -> { activeProjectId = id; renderSidebar(sidebarChats); });
            if (project != null) chip.setOnLongClickListener(v -> { dismissSidebar(); openProject(id); return true; });
        }
        TextView chatHeading = label("CHATS", 10, MUTED);
        chatHeading.setLetterSpacing(0.07f);
        chatHeading.setPadding(dp(10), dp(20), 0, dp(12));
        sidebarList.addView(chatHeading);
        int count = 0;
        for (int pass = 0; pass < 2; pass++) for (int i = 0; i < chats.length(); i++) {
            JSONObject chat = chats.optJSONObject(i);
            if (chat == null || chat.optBoolean("archived") != showArchivedChats) continue;
            if (!activeProjectId.isEmpty() && !activeProjectId.equals(chat.optString("projectId"))) continue;
            if (chat.optBoolean("pinned") != (pass == 0)) continue;
            count++;
            String id = chat.optString("id");
            String title = chat.optString("title", "Untitled");
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            if (id.equals(activeChatId)) row.setBackground(background(SECONDARY, dp(8)));
            TextView text = label((chat.optBoolean("pinned") ? "· " : "") + title, 13, id.equals(activeChatId) ? FG : MUTED);
            text.setSingleLine(true); text.setEllipsize(TextUtils.TruncateAt.END);
            text.setGravity(Gravity.CENTER_VERTICAL);
            text.setPadding(dp(6), dp(8), dp(10), dp(8));
            row.addView(text, new LinearLayout.LayoutParams(0, dp(40), 1));
            text.setOnClickListener(v -> { dismissSidebar(); openChat(id, title); });
            ImageView more = icon("ellipsis", "Actions for " + title, 14);
            more.setPadding(dp(13), dp(13), dp(13), dp(13));
            row.addView(more, new LinearLayout.LayoutParams(dp(40), dp(40)));
            more.setOnClickListener(v -> showChatActions(v, id, title, chat.optBoolean("archived")));
            sidebarList.addView(row);
        }
        if (count == 0) sidebarList.addView(label(showArchivedChats ? "No archived chats" : "No chats yet", 13, MUTED));
    }

    private void addSearchCommands(LinearLayout list) {
        TextView heading = label("COMMANDS", 11, MUTED);
        heading.setPadding(dp(4), dp(10), dp(4), dp(8));
        list.addView(heading);
        list.addView(navRow("plus", "New chat", () -> {
            activeChatId = ""; currentWorkspaces = new JSONArray();
            showConversation("New chat", new JSONArray(), false);
        }));
        list.addView(navRow("sticky_note", "Open shared notes", this::loadNotes));
        list.addView(navRow("folder", "Open projects", this::loadProjects));
        list.addView(navRow("panel_right", "Toggle workspace", this::openWorkspaces));
        list.addView(navRow("search", "Choose model", this::chooseModel));
        list.addView(navRow("settings", "Open settings", this::showSettings));
    }

    private void showSearch() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(12), 0, dp(12), dp(8));
        form.setBackground(outlinedSurface(SURFACE, dp(12)));
        EditText query = input("Search chats or run a command…", false);
        query.setBackgroundColor(Color.TRANSPARENT);
        query.setTextSize(14);
        query.setPadding(dp(6), 0, dp(6), 0);
        LinearLayout searchHeader = new LinearLayout(this);
        searchHeader.setGravity(Gravity.CENTER_VERTICAL);
        ImageView searchIcon = icon("search", "", 16);
        searchIcon.setPadding(0, 0, 0, 0);
        searchHeader.addView(searchIcon, new LinearLayout.LayoutParams(dp(18), dp(18)));
        searchHeader.addView(query, new LinearLayout.LayoutParams(0, dp(48), 1));
        form.addView(searchHeader);
        ScrollView scroll = new ScrollView(this);
        LinearLayout results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL);
        addSearchCommands(results);
        scroll.addView(results);
        form.addView(scroll, new LinearLayout.LayoutParams(-1, dp(320)));
        Dialog dialog = new Dialog(this);
        sidebarDialog = dialog;
        dialog.setContentView(form);
        dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        TextView close = label("×", 20, MUTED);
        close.setContentDescription("Close search");
        close.setGravity(Gravity.CENTER);
        close.setOnClickListener(v -> dialog.dismiss());
        searchHeader.addView(close, new LinearLayout.LayoutParams(dp(36), dp(48)));
        final int[] generation = {0};
        android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        query.addTextChangedListener(new android.text.TextWatcher() {
            public void beforeTextChanged(CharSequence v, int start, int count, int after) {}
            public void onTextChanged(CharSequence v, int start, int before, int count) {
                int version = ++generation[0];
                String term = v.toString().trim();
                handler.postDelayed(() -> {
                    if (version != generation[0] || !dialog.isShowing()) return;
                    results.removeAllViews();
                    if (term.isEmpty()) { addSearchCommands(results); return; }
                    results.addView(label("Searching…", 13, MUTED));
                    network.execute(() -> {
                        try {
                            JSONArray matches = requestJson("/api/chats/search?q=" + encodePath(term) + "&limit=30",
                                "GET", null).optJSONArray("results");
                            runOnUiThread(() -> {
                                if (version != generation[0] || !dialog.isShowing()) return;
                                results.removeAllViews();
                                if (matches == null || matches.length() == 0) results.addView(label("No results", 13, MUTED));
                                if (matches != null) for (int i = 0; i < matches.length(); i++) {
                                    JSONObject match = matches.optJSONObject(i);
                                    if (match == null) continue;
                                    LinearLayout item = new LinearLayout(MainActivity.this);
                                    item.setOrientation(LinearLayout.VERTICAL);
                                    item.setPadding(dp(8), dp(12), dp(8), dp(12));
                                    item.addView(label(match.optString("chatTitle"), 14, FG));
                                    TextView snippet = label(match.optString("snippet"), 12, MUTED);
                                    snippet.setMaxLines(2); item.addView(snippet);
                                    item.setOnClickListener(x -> { dialog.dismiss(); openChat(match.optString("chatId"), match.optString("chatTitle")); });
                                    results.addView(item);
                                }
                            });
                        } catch (Exception ex) {
                            runOnUiThread(() -> {
                                if (version != generation[0] || !dialog.isShowing()) return;
                                results.removeAllViews(); results.addView(label(messageFor(ex), 13, MUTED));
                            });
                        }
                    });
                }, 250);
            }
            public void afterTextChanged(android.text.Editable v) {}
        });
        dialog.show();
        dialog.getWindow().setLayout(getResources().getDisplayMetrics().widthPixels - dp(32), -2);
        WindowManager.LayoutParams position = dialog.getWindow().getAttributes();
        position.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        position.y = (int) (getResources().getDisplayMetrics().heightPixels * 0.14f);
        dialog.getWindow().setAttributes(position);
    }

    private void loadProjects() {
        network.execute(() -> {
            try {
                JSONObject result = requestJson("/api/projects", "GET", null);
                JSONArray projects = result.optJSONArray("projects");
                runOnUiThread(() -> showProjects(projects == null ? new JSONArray() : projects));
            } catch (Exception ex) {
                runOnUiThread(() -> toastMessage(messageFor(ex)));
            }
        });
    }

    private void showProjects(JSONArray projects) {
        activeChatId = "";
        activeProjectId = "";
        LinearLayout root = page();
        header(root, "Projekte", "☰", v -> openNavigation(v));
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(18), dp(10), dp(18), dp(24));
        TextView create = label("＋  Neues Projekt", 15, FG);
        create.setPadding(dp(10), dp(14), dp(10), dp(14));
        create.setOnClickListener(v -> createProject());
        list.addView(create);
        for (int i = 0; i < projects.length(); i++) {
            JSONObject project = projects.optJSONObject(i);
            if (project == null) continue;
            String id = project.optString("id");
            TextView row = label(project.optString("icon", "▣") + "  " + project.optString("name", "Projekt"), 16, FG);
            row.setPadding(dp(10), dp(16), dp(10), dp(16));
            list.addView(row);
            row.setOnClickListener(v -> openProject(id));
        }
        ScrollView scroll = new ScrollView(this);
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private void createProject() {
        EditText name = input("Projektname", false);
        new AlertDialog.Builder(this).setTitle("Neues Projekt").setView(name)
            .setNegativeButton("Abbrechen", null)
            .setPositiveButton("Erstellen", (d, which) -> network.execute(() -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("name", name.getText().toString().trim());
                    requestJson("/api/projects", "POST", body);
                    loadProjects();
                } catch (Exception ex) {
                    runOnUiThread(() -> toastMessage(messageFor(ex)));
                }
            })).show();
    }

    private void openProject(String id) {
        network.execute(() -> {
            try {
                JSONObject result = requestJson("/api/projects/" + encodePath(id), "GET", null);
                runOnUiThread(() -> showProject(result));
            } catch (Exception ex) {
                runOnUiThread(() -> toastMessage(messageFor(ex)));
            }
        });
    }

    private void showProject(JSONObject result) {
        JSONObject project = result.optJSONObject("project");
        if (project == null) return;
        activeProjectId = project.optString("id");
        LinearLayout root = page();
        header(root, project.optString("name", "Projekt"), "☰", v -> openNavigation(v));
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(20), dp(16), dp(20), dp(24));
        String instructions = project.optString("instructions", "");
        if (!instructions.isEmpty()) {
            TextView desc = label(instructions, 14, MUTED);
            desc.setPadding(0, 0, 0, dp(18));
            list.addView(desc);
        }
        addProjectSection(list, "Chats", result.optJSONArray("chats"), true);
        addProjectSection(list, "Notizen", result.optJSONArray("notes"), false);
        addProjectSection(list, "Dateien", result.optJSONArray("files"), false);
        Button newChat = button("＋  Chat in diesem Projekt");
        newChat.setOnClickListener(v -> createChat(newChat));
        list.addView(newChat);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private void addProjectSection(LinearLayout list, String title, JSONArray items, boolean chats) {
        TextView heading = label(title, 13, MUTED);
        heading.setPadding(0, dp(12), 0, dp(6));
        list.addView(heading);
        if (items == null || items.length() == 0) {
            TextView empty = label("Noch keine Einträge", 14, MUTED);
            empty.setPadding(0, dp(8), 0, dp(8));
            list.addView(empty);
            return;
        }
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String id = item.optString("id");
            String name = item.optString("title", chats ? "Chat" : "Eintrag");
            TextView row = label(name, 15, FG);
            row.setPadding(dp(4), dp(12), dp(4), dp(12));
            list.addView(row);
            if (chats) row.setOnClickListener(v -> openChat(id, name));
        }
    }


    private void loadAutomations() {
        network.execute(() -> {
            try {
                JSONObject result = requestJson("/api/automations", "GET", null);
                JSONArray automations = result.optJSONArray("automations");
                runOnUiThread(() -> showAutomations(automations == null ? new JSONArray() : automations));
            } catch (Exception ex) {
                runOnUiThread(() -> toastMessage(messageFor(ex)));
            }
        });
    }

    private void showAutomations(JSONArray automations) {
        activeChatId = "";
        LinearLayout root = page();
        header(root, "Automatisierungen", "☰", v -> openNavigation(v));
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(18), dp(10), dp(18), dp(24));
        for (int i = 0; i < automations.length(); i++) {
            JSONObject item = automations.optJSONObject(i);
            if (item == null) continue;
            TextView name = label(item.optString("name", "Automatisierung"), 16, FG);
            name.setPadding(dp(8), dp(14), dp(8), dp(5));
            list.addView(name);
            TextView prompt = label(item.optString("prompt", ""), 14, MUTED);
            prompt.setPadding(dp(8), 0, dp(8), dp(14));
            list.addView(prompt);
        }
        if (automations.length() == 0) {
            TextView empty = label("Noch keine Automatisierungen eingerichtet.", 15, MUTED);
            empty.setPadding(dp(8), dp(8), dp(8), dp(8));
            list.addView(empty);
        }
        ScrollView scroll = new ScrollView(this);
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private void openBrowser(){dismissSidebar();if(activeChatId.isEmpty()){LinearLayout root=page();header(root,"Browser","☰",v->openNavigation(v));TextView empty=label("Open a chat to use its shared browser session.",14,MUTED);empty.setPadding(dp(20),dp(24),dp(20),dp(12));root.addView(empty);Button start=button("New chat");root.addView(start);start.setOnClickListener(v->createChat(start));setContentView(root);return;}showBrowser();browserAction("screenshot",null);}
    private void showBrowser(){LinearLayout root=page();header(root,"Browser","☰",v->openNavigation(v));LinearLayout addressRow=new LinearLayout(this);addressRow.setPadding(dp(12),dp(6),dp(12),dp(4));browserAddress=input("Address or search",false);addressRow.addView(browserAddress,new LinearLayout.LayoutParams(0,dp(48),1));Button go=button("Go");addressRow.addView(go,new LinearLayout.LayoutParams(dp(54),dp(48)));go.setOnClickListener(v->navigateBrowser());browserAddress.setOnEditorActionListener((field,action,event)->{navigateBrowser();return true;});root.addView(addressRow);
        LinearLayout actions=new LinearLayout(this);actions.setPadding(dp(12),0,dp(12),dp(4));for(String name:new String[]{"Back","Forward","Reload","History","Type"}){TextView action=label(name,12,FG);action.setGravity(Gravity.CENTER);action.setPadding(dp(2),0,dp(2),0);action.setBackground(outlinedSurface(SURFACE,dp(8)));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,dp(40),1);lp.setMargins(dp(2),0,dp(2),0);actions.addView(action,lp);action.setOnClickListener(v->{if(name.equals("History"))showBrowserHistory();else if(name.equals("Type"))promptBrowserText();else browserAction(name.toLowerCase(Locale.US),null);});}root.addView(actions);
        FrameLayout viewport=new FrameLayout(this);viewport.setBackgroundColor(Color.rgb(10,10,10));browserFrame=new ImageView(this);browserFrame.setScaleType(ImageView.ScaleType.FIT_CENTER);browserFrame.setContentDescription("Shared browser page");viewport.addView(browserFrame,new FrameLayout.LayoutParams(-1,-1));browserStatus=label("Connects to the browser session for this chat.",13,MUTED);browserStatus.setGravity(Gravity.CENTER);viewport.addView(browserStatus,new FrameLayout.LayoutParams(-1,-1));browserFrame.setOnTouchListener((view,event)->{if(event.getActionMasked()==MotionEvent.ACTION_DOWN){browserTouchX=event.getX();browserTouchY=event.getY();return true;}if(event.getActionMasked()==MotionEvent.ACTION_UP){float dx=event.getX()-browserTouchX,dy=event.getY()-browserTouchY;if(Math.abs(dy)>dp(18))browserAction("scroll",browserBody("deltaY",Math.round(-dy*browserHeight/Math.max(1,browserFrame.getHeight()))));else browserAction("click",browserBody("x",Math.round(event.getX()*browserWidth/Math.max(1,browserFrame.getWidth())),"y",Math.round(event.getY()*browserHeight/Math.max(1,browserFrame.getHeight()))));return true;}return true;});root.addView(viewport,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);}
    private void navigateBrowser(){String raw=browserAddress.getText().toString().trim();if(raw.isEmpty())return;String url=raw.matches("(?i)^[a-z][a-z0-9+.-]*://.*")?raw:raw.matches("(?i)^(localhost|(?:\\\\d{1,3}\\\\.){3}\\\\d{1,3})(?::\\\\d+)?(?:/.*)?$")?"http://"+raw:raw.contains(".")&&!raw.contains(" ")?"https://"+raw:"https://www.google.com/search?q="+URLEncoder.encode(raw);browserAddress.setText(url);browserAction("navigate",browserBody("url",url));}
    private JSONObject browserBody(Object... values){JSONObject body=new JSONObject();try{for(int i=0;i+1<values.length;i+=2)body.put(String.valueOf(values[i]),values[i+1]);}catch(org.json.JSONException ignored){}return body;}
    private void browserAction(String action,JSONObject extra){String chat=activeChatId;if(chat.isEmpty()){toastMessage("Open a chat to use its browser.");return;}if(browserStatus!=null)browserStatus.setText("Loading…");network.execute(()->{try{JSONObject body=extra==null?new JSONObject():new JSONObject(extra.toString());body.put("chatId",chat).put("action",action);JSONObject result=requestJson("/api/browser","POST",body);String screenshot=result.optString("screenshot");String url=result.optString("url");runOnUiThread(()->{if(!chat.equals(activeChatId))return;if(!url.isEmpty()&&browserAddress!=null)browserAddress.setText(url.equals("about:blank")?"":url);JSONObject viewport=result.optJSONObject("viewport");if(viewport!=null){browserWidth=viewport.optInt("width",browserWidth);browserHeight=viewport.optInt("height",browserHeight);}if(!screenshot.isEmpty()&&browserFrame!=null){byte[] bytes=Base64.decode(screenshot,Base64.DEFAULT);browserFrame.setImageBitmap(android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length));browserFrame.setVisibility(View.VISIBLE);browserStatus.setVisibility(View.GONE);}else if(browserStatus!=null){browserStatus.setText(url.isEmpty()?"Browser action complete":"No page preview received.");browserStatus.setVisibility(View.VISIBLE);}});}catch(Exception ex){runOnUiThread(()->{if(browserStatus!=null){browserStatus.setText(messageFor(ex));browserStatus.setVisibility(View.VISIBLE);}else toastMessage(messageFor(ex));});}});}
    private void promptBrowserText(){EditText text=input("Text for the focused page field",false);new AlertDialog.Builder(this).setTitle("Type in page").setView(text).setNegativeButton("Cancel",null).setPositiveButton("Type",(d,w)->browserAction("type",browserBody("text",text.getText().toString()))).show();}
    private void showBrowserHistory(){String chat=activeChatId;network.execute(()->{try{JSONArray history=requestJson("/api/browser/history?chatId="+URLEncoder.encode(chat,"UTF-8"),"GET",null).optJSONArray("history");runOnUiThread(()->{if(history==null||history.length()==0){new AlertDialog.Builder(this).setTitle("Browser history").setMessage("No history for this chat yet.").setPositiveButton("Close",null).show();return;}String[] labels=new String[history.length()];for(int i=0;i<labels.length;i++){JSONObject item=history.optJSONObject(i);labels[i]=item.optString("title",item.optString("url"));}new AlertDialog.Builder(this).setTitle("Browser history").setItems(labels,(d,i)->{JSONObject item=history.optJSONObject(i);browserAddress.setText(item.optString("url"));browserAction("navigate",browserBody("url",item.optString("url")));}).setNegativeButton("Close",null).show();});}catch(Exception ex){runOnUiThread(()->toastMessage(messageFor(ex)));}});}

    private void loadMemories() {
        dismissSidebar(); network.execute(() -> { try { JSONArray memories=requestJson("/api/memories","GET",null).optJSONArray("memories");runOnUiThread(()->showMemories(memories==null?new JSONArray():memories)); }
            catch(Exception ex){runOnUiThread(()->toastMessage(messageFor(ex)));} });
    }

    private void showMemories(JSONArray memories) {
        activeChatId="";LinearLayout root=page();header(root,"Memories","☰",v->openNavigation(v));LinearLayout list=new LinearLayout(this);list.setOrientation(1);list.setPadding(dp(18),dp(10),dp(18),dp(24));
        TextView create=label("＋  Add memory",15,FG);create.setPadding(dp(10),dp(14),dp(10),dp(14));create.setOnClickListener(v->editMemory(null));list.addView(create);
        for(int i=0;i<memories.length();i++){JSONObject memory=memories.optJSONObject(i);if(memory==null)continue;LinearLayout row=new LinearLayout(this);row.setOrientation(1);row.setPadding(dp(10),dp(12),dp(10),dp(12));TextView content=label(memory.optString("content"),15,FG);row.addView(content);JSONArray tags=memory.optJSONArray("tags");if(tags!=null&&tags.length()>0){StringJoiner joined=new StringJoiner(" · ");for(int j=0;j<tags.length();j++)joined.add(tags.optString(j));row.addView(label(joined.toString(),12,MUTED));}list.addView(row);row.setOnClickListener(v->editMemory(memory));row.setOnLongClickListener(v->{new AlertDialog.Builder(this).setTitle("Delete memory?").setMessage(memory.optString("content")).setNegativeButton("Cancel",null).setPositiveButton("Delete",(d,w)->network.execute(()->{try{requestJson("/api/memories/"+encodePath(memory.optString("id")),"DELETE",null);loadMemories();}catch(Exception ex){runOnUiThread(()->toastMessage(messageFor(ex)));}})).show();return true;});}
        if(memories.length()==0){TextView empty=label("No saved memories yet. Add one to keep a useful fact available across chats.",14,MUTED);empty.setPadding(dp(10),dp(8),dp(10),dp(8));list.addView(empty);}
        ScrollView scroll=new ScrollView(this);scroll.addView(list);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
    }

    private void editMemory(JSONObject memory) {
        LinearLayout form=new LinearLayout(this);form.setOrientation(1);form.setPadding(dp(16),dp(8),dp(16),dp(12));EditText content=input("Memory",false);content.setSingleLine(false);content.setMinLines(4);EditText tags=input("Tags, separated by commas",false);form.addView(content);form.addView(tags);
        if(memory!=null){content.setText(memory.optString("content"));JSONArray current=memory.optJSONArray("tags");if(current!=null){StringJoiner joined=new StringJoiner(", ");for(int i=0;i<current.length();i++)joined.add(current.optString(i));tags.setText(joined.toString());}}
        new AlertDialog.Builder(this).setTitle(memory==null?"Add memory":"Edit memory").setView(form).setNegativeButton("Cancel",null).setPositiveButton("Save",(d,w)->network.execute(()->{try{JSONArray labels=new JSONArray();for(String tag:tags.getText().toString().split(","))if(!tag.trim().isEmpty())labels.put(tag.trim());JSONObject body=new JSONObject().put("content",content.getText().toString().trim()).put("tags",labels);if(memory==null)requestJson("/api/memories","POST",body);else requestJson("/api/memories/"+encodePath(memory.optString("id")),"PATCH",body);loadMemories();}catch(Exception ex){runOnUiThread(()->toastMessage(messageFor(ex)));}})).show();
    }

    private void loadSkills(){dismissSidebar();network.execute(()->{try{JSONObject result=requestJson("/api/skills","GET",null);JSONArray skills=result.optJSONArray("skills");runOnUiThread(()->showSkills(skills==null?new JSONArray():skills));}catch(Exception ex){runOnUiThread(()->toastMessage(messageFor(ex)));}});}
    private void showSkills(JSONArray skills){activeChatId="";LinearLayout root=page();header(root,"Skills","☰",v->openNavigation(v));LinearLayout list=new LinearLayout(this);list.setOrientation(1);list.setPadding(dp(18),dp(10),dp(18),dp(24));
        for(int i=0;i<skills.length();i++){JSONObject skill=skills.optJSONObject(i);if(skill==null)continue;String id=skill.optString("id");Switch toggle=new Switch(this);toggle.setText(skill.optString("name",id));toggle.setTextColor(FG);toggle.setTextSize(15);toggle.setChecked(skill.optBoolean("enabled"));list.addView(toggle,new LinearLayout.LayoutParams(-1,dp(52)));TextView description=label(skill.optString("description",""),13,MUTED);description.setPadding(dp(2),0,dp(2),dp(12));list.addView(description);toggle.setOnCheckedChangeListener((button,enabled)->saveSkillToggle(id,button,enabled));}
        if(skills.length()==0){TextView empty=label("No skills are available on this server.",14,MUTED);empty.setPadding(dp(10),dp(8),dp(10),dp(8));list.addView(empty);}ScrollView scroll=new ScrollView(this);scroll.addView(list);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);}

    private void saveSkillToggle(String id,CompoundButton toggle,boolean enabled){network.execute(()->{try{JSONObject patch=new JSONObject().put("enabledSkills",new JSONObject().put(id,enabled));requestJson("/api/skills","PATCH",patch);}catch(Exception ex){runOnUiThread(()->{toggle.setOnCheckedChangeListener(null);toggle.setChecked(!enabled);toggle.setOnCheckedChangeListener((button,value)->saveSkillToggle(id,toggle,value));toastMessage(messageFor(ex));});}});}

    private void loadNotes() {
        network.execute(() -> {
            try {
                JSONObject result = requestJson("/api/notes?scope=global", "GET", null);
                JSONArray notes = result.optJSONArray("notes");
                runOnUiThread(() -> showNotes(notes == null ? new JSONArray() : notes));
            } catch (Exception ex) {
                runOnUiThread(() -> toastMessage(messageFor(ex)));
            }
        });
    }

    private void showNotes(JSONArray notes) {
        activeChatId = "";
        LinearLayout root = page();
        header(root, "Geteilte Notizen", "☰", v -> openNavigation(v));
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(18), dp(10), dp(18), dp(24));
        TextView create = label("＋  Neue Notiz", 15, FG);
        create.setPadding(dp(10), dp(14), dp(10), dp(14));
        create.setOnClickListener(v -> editNote(null));
        list.addView(create);
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.optJSONObject(i);
            if (note == null) continue;
            TextView row = label(note.optString("title", "Ohne Titel"), 16, FG);
            row.setPadding(dp(10), dp(15), dp(10), dp(15));
            list.addView(row);
            row.setOnClickListener(v -> editNote(note));
        }
        ScrollView scroll = new ScrollView(this);
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }

    private void editNote(JSONObject note) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        EditText title = input("Titel", false);
        EditText content = input("Inhalt", false);
        content.setSingleLine(false);
        content.setMinLines(5);
        if (note != null) {
            title.setText(note.optString("title"));
            content.setText(note.optString("content"));
        }
        form.addView(title);
        form.addView(content);
        new AlertDialog.Builder(this).setTitle(note == null ? "Neue Notiz" : "Notiz bearbeiten")
            .setView(form).setNegativeButton("Abbrechen", null)
            .setPositiveButton("Speichern", (d, which) -> network.execute(() -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("title", title.getText().toString().trim());
                    body.put("content", content.getText().toString());
                    body.put("scope", "global");
                    if (note == null) requestJson("/api/notes", "POST", body);
                    else requestJson("/api/notes/" + encodePath(note.optString("id")), "PATCH", body);
                    loadNotes();
                } catch (Exception ex) {
                    runOnUiThread(() -> toastMessage(messageFor(ex)));
                }
            })).show();
    }

    private void loadModels() {
        try {
            JSONObject response = requestJson("/api/models", "GET", null);
            try { JSONObject settings = requestJson("/api/preferences", "GET", null).optJSONObject("settings"); if (settings != null) globalModelPreferences = settings; } catch (Exception ignored) {}
            JSONArray models = response.optJSONArray("models");
            if (models != null) availableModels = models;
            String defaultId = response.optString("defaultModelId", "");
            if (selectedModelId.isEmpty()) selectedModelId = defaultId;
            for (int i = 0; i < availableModels.length(); i++) {
                JSONObject model = availableModels.optJSONObject(i);
                if (model != null && selectedModelId.equals(model.optString("id"))) {
                    selectedModelName = model.optString("displayName", model.optString("id"));
                    break;
                }
            }
        } catch (Exception ignored) {
            // Chat functions remain available using the server's default model.
        }
    }

    private void chooseModel() {
        if (availableModels.length() == 0) {
            toastMessage("Für dieses Konto sind keine Modelle verfügbar.");
            return;
        }
        String[] names = new String[availableModels.length()];
        int checked = -1;
        for (int i = 0; i < availableModels.length(); i++) {
            JSONObject model = availableModels.optJSONObject(i);
            names[i] = model == null ? "Unbekanntes Modell" : model.optString("displayName", model.optString("id"));
            if (model != null && selectedModelId.equals(model.optString("id"))) checked = i;
        }
        new AlertDialog.Builder(this).setTitle("Modell auswählen").setSingleChoiceItems(names, checked, (dialog, which) -> {
            JSONObject model = availableModels.optJSONObject(which);
            if (model == null) return;
            selectedModelId = model.optString("id");
            selectedModelName = model.optString("displayName", selectedModelId);
            if (modelButton != null) modelButton.setText(selectedModelName + "  ⌄");
            String chatId = activeChatId;
            if (!chatId.isEmpty()) updateChat(chatId, "modelId", selectedModelId);
            updateContextFooter();
            dialog.dismiss();
        }).setNegativeButton("Abbrechen", null).show();
    }

    private void showChatList() {
        loadChatList();
    }

    private void showChatList(JSONArray chats) {
        sidebarChats = chats;
        activeChatId = "";
        activeProjectId = "";
        showConversation("New chat", new JSONArray(), false);
    }

    private void showChatActions(View anchor, String chatId, String title, boolean archived) {
        PopupMenu menu = new PopupMenu(this, anchor);
        boolean pinned = false;
        for (int i = 0; i < sidebarChats.length(); i++) {
            JSONObject chat = sidebarChats.optJSONObject(i);
            if (chat != null && chatId.equals(chat.optString("id"))) pinned = chat.optBoolean("pinned");
        }
        final boolean nextPinned = !pinned;
        menu.getMenu().add(pinned ? "Unpin" : "Pin").setOnMenuItemClickListener(item -> {
            updateChat(chatId, "pinned", Boolean.toString(nextPinned)); return true;
        });
        menu.getMenu().add("Move to project").setOnMenuItemClickListener(item -> {
            moveChatToProject(chatId); return true;
        });
        menu.getMenu().add("Umbenennen").setOnMenuItemClickListener(item -> {
            EditText name = input("Chatname", false);
            name.setText(title);
            new AlertDialog.Builder(this).setTitle("Chat umbenennen").setView(name)
                .setNegativeButton("Abbrechen", null)
                .setPositiveButton("Speichern", (dialog, which) -> updateChat(chatId, "title", name.getText().toString().trim()))
                .show();
            return true;
        });
        menu.getMenu().add(archived ? "Wiederherstellen" : "Archivieren")
            .setOnMenuItemClickListener(item -> {
                updateChat(chatId, "archived", archived ? "false" : "true");
                return true;
            });
        menu.getMenu().add("Löschen").setOnMenuItemClickListener(item -> {
            new AlertDialog.Builder(this).setTitle("Chat löschen?")
                .setMessage("Der Chat und sein Verlauf werden dauerhaft gelöscht.")
                .setNegativeButton("Abbrechen", null)
                .setPositiveButton("Löschen", (dialog, which) -> deleteChat(chatId))
                .show();
            return true;
        });
        menu.show();
    }

    private void moveChatToProject(String chatId) {
        network.execute(() -> {
            try {
                JSONArray projects = requestJson("/api/projects", "GET", null).optJSONArray("projects");
                ArrayList<String> ids = new ArrayList<>();
                ArrayList<String> names = new ArrayList<>();
                ids.add(""); names.add("Remove from project");
                if (projects != null) for (int i = 0; i < projects.length(); i++) {
                    JSONObject project = projects.optJSONObject(i);
                    if (project != null) { ids.add(project.optString("id")); names.add(project.optString("name")); }
                }
                runOnUiThread(() -> new AlertDialog.Builder(this).setTitle("Move to project")
                    .setItems(names.toArray(new String[0]), (d, which) -> updateChat(chatId, "projectId", ids.get(which)))
                    .setNegativeButton("Cancel", null).show());
            } catch (Exception ex) { runOnUiThread(() -> toastMessage(messageFor(ex))); }
        });
    }

    private void updateChat(String chatId, String field, String value) {
        network.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                if ("archived".equals(field) || "pinned".equals(field)) body.put(field, Boolean.parseBoolean(value));
                else if ("projectId".equals(field) && value.isEmpty()) body.put(field, JSONObject.NULL);
                else body.put(field, value);
                requestJson("/api/chats/" + encodePath(chatId), "PATCH", body);
                runOnUiThread(() -> {
                    if (!"modelId".equals(field)) {
                        if (sidebarDialog != null && sidebarDialog.isShowing()) refreshSidebar();
                        else if (activeChatId.isEmpty()) loadChatList();
                    }
                });
            } catch (Exception ex) {
                runOnUiThread(() -> toastMessage(messageFor(ex)));
            }
        });
    }

    private void deleteChat(String chatId) {
        network.execute(() -> {
            try {
                requestJson("/api/chats/" + encodePath(chatId), "DELETE", null);
                runOnUiThread(this::loadChatList);
            } catch (Exception ex) {
                runOnUiThread(() -> toastMessage(messageFor(ex)));
            }
        });
    }

    private void createChat(Button source) {
        source.setEnabled(false);
        network.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                if (!selectedModelId.isEmpty()) body.put("modelId", selectedModelId);
                body.put("modeId", selectedAgentMode);
                if (!activeProjectId.isEmpty()) body.put("projectId", activeProjectId);
                if (incognitoMode) body.put("incognito", true);
                JSONObject result = requestJson("/api/chats", "POST", body);
                JSONObject chat = result.optJSONObject("chat");
                if (chat == null) throw new Exception("Der Server hat keinen Chat zurückgegeben.");
                String id = chat.optString("id");
                String title = chat.optString("title", "Neuer Chat");
                runOnUiThread(() -> openChat(id, title));
            } catch (Exception ex) {
                runOnUiThread(() -> {
                    source.setEnabled(true);
                    toastMessage(messageFor(ex));
                });
            }
        });
    }

    private void openChat(String id, String title) {
        activeChatId = id;
        busyRun = false;
        currentWorkspaces = new JSONArray();
        showConversation(title, new JSONArray(), false);
        network.execute(() -> {
            try {
                JSONObject result = requestJson(
                    "/api/chats/" + encodePath(id) + "?messageLimit=100",
                    "GET", null
                );
                JSONObject chat = result.optJSONObject("chat");
                if (chat != null) {
                    JSONObject session = chat.optJSONObject("sessionState");
                    currentSessionState = session == null ? new JSONObject() : session;
                    selectedAgentMode = currentSessionState.optString("modeId", "agent");
                    JSONArray workspaces = chat.optJSONArray("workspaces");
                    currentWorkspaces = workspaces == null ? new JSONArray() : workspaces;
                }
                if (chat != null) {
                    incognitoMode = chat.optBoolean("incognito", false);
                    activeProjectId = chat.optString("projectId");
                }
                if (chat != null && !chat.optString("modelId").isEmpty()) {
                    selectedModelId = chat.optString("modelId");
                    for (int i = 0; i < availableModels.length(); i++) {
                        JSONObject model = availableModels.optJSONObject(i);
                        if (model != null && selectedModelId.equals(model.optString("id"))) selectedModelName = model.optString("displayName", selectedModelId);
                    }
                }
                JSONArray messages = chat == null ? new JSONArray() : chat.optJSONArray("messages");
                if (messages == null) messages = new JSONArray();
                JSONArray finalMessages = messages;
                runOnUiThread(() -> {
                    if (id.equals(activeChatId)) {
                        String state = chat == null ? "" : chat.optString("runStatus");
                        boolean running = "running".equals(state) || "waiting_for_user".equals(state) || "waiting_input".equals(state);
                        showConversation(title, finalMessages, running);
                        if (chat != null && chat.optJSONObject("pendingQuestion") != null) showPendingQuestion(chat.optJSONObject("pendingQuestion"));
                        if (running) new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                            if (id.equals(activeChatId)) openChat(id, title);
                        }, 1800);
                        if (chat != null && chat.optJSONObject("pendingApproval") != null) showApproval(chat.optJSONObject("pendingApproval"));
                    }
                });
            } catch (Exception ex) {
                runOnUiThread(() -> {
                    if (id.equals(activeChatId)) toastMessage(messageFor(ex));
                });
            }
        });
    }

    private void showConversation(String title, JSONArray messages, boolean busy) {
        conversationMessages = messages;
        busyRun = busy;
        liveAssistantText = null;
        liveStatus = null;
        LinearLayout root = page();
        chatHeader(root);

        ScrollView scroll = new ScrollView(this);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(20), dp(18), dp(20), dp(14));
        for (int i = 0; i < messages.length(); i++) {
            JSONObject message = messages.optJSONObject(i);
            if (message == null) continue;
            JSONArray tools = message.optJSONArray("tools");
            if (tools != null) for (int j = 0; j < tools.length(); j++) {
                JSONObject tool = tools.optJSONObject(j);
                if (tool != null) { try { tool.put("_messageId", message.optString("id")); } catch (Exception ignored) {} addToolCard(column, tool); }
            }
            addMessageBubble(column, message.optString("role"), message.optString("content"));
        }
        liveStatus = label(busy ? "Metis antwortet …" : "", 13, MUTED);
        liveStatus.setPadding(dp(12), dp(6), dp(12), dp(10));
        column.addView(liveStatus);
        scroll.addView(column);

        LinearLayout composeRow = new LinearLayout(this);
        composeRow.setGravity(Gravity.CENTER_VERTICAL);
        composeRow.setPadding(dp(7), dp(5), dp(7), dp(5));
        composeRow.setBackground(outlinedSurface(Color.rgb(18, 18, 18), dp(18)));
        composer = input("Message Metis…", false);
        composer.setSingleLine(false);
        composer.setMinLines(1);
        composer.setMaxLines(5);
        composer.setInputType(147457);
        composer.setBackgroundColor(Color.TRANSPARENT);
        composer.setPadding(dp(10), dp(10), dp(8), dp(10));
        composer.setHintTextColor(Color.rgb(120, 120, 120));
        ImageView attach = icon("plus", "Attach files", 20);
        attach.setContentDescription("Attach files");
        attach.setPadding(dp(6), 0, dp(8), 0);
        attach.setOnClickListener(v -> pickAttachments());
        composeRow.addView(attach, new LinearLayout.LayoutParams(dp(38), dp(42)));
        composeRow.addView(composer, new LinearLayout.LayoutParams(0, -2, 1));
        ImageView mic = icon("mic", "Voice input", 18);
        mic.setOnClickListener(v -> startVoice());
        composeRow.addView(mic, new LinearLayout.LayoutParams(dp(36), dp(42)));
        sendButton = button("↑");
        sendButton.setTextColor(FG);
        sendButton.setBackground(background(Color.rgb(112, 112, 112), dp(999)));
        sendButton.setContentDescription("Send");
        sendButton.setPadding(0, 0, 0, 0);
        LinearLayout.LayoutParams sendParams = new LinearLayout.LayoutParams(dp(40), dp(40));
        sendParams.leftMargin = dp(6);
        composeRow.addView(sendButton, sendParams);
        LinearLayout.LayoutParams composeParams = new LinearLayout.LayoutParams(-1, -2);
        composeParams.setMargins(dp(12), dp(8), dp(12), dp(8));

        boolean emptyChat = messages.length() == 0 && !busy;
        final FrameLayout emptyState = emptyChat ? new FrameLayout(this) : null;
        if (emptyChat) {
            LinearLayout welcome = new LinearLayout(this);
            welcome.setOrientation(LinearLayout.VERTICAL);
            welcome.setGravity(Gravity.CENTER_HORIZONTAL);
            TextView greeting = label(homeGreeting(), 28, FG);
            greeting.setLetterSpacing(-0.035f);
            greeting.setTypeface(webSemibold);
            greeting.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams greetingParams = new LinearLayout.LayoutParams(-1, -2);
            greetingParams.bottomMargin = dp(20);
            welcome.addView(greeting, greetingParams);

            FrameLayout.LayoutParams welcomeParams = new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER);
            welcomeParams.topMargin = -dp(35);
            emptyState.addView(welcome, welcomeParams);
            root.addView(emptyState, new LinearLayout.LayoutParams(-1, 0, 1));
            root.addView(composeRow, composeParams);
        } else {
            root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
            root.addView(composeRow, composeParams);
        }

        composer.setEnabled(!busy);
        sendButton.setEnabled(true);
        setSendState(busy);
        sendButton.setOnClickListener(v -> {
            if (busyRun) { cancelRun(activeChatId); return; }
            String text = composer.getText().toString().trim();
            if (text.isEmpty() && pendingAttachments.isEmpty()) return;
            if (emptyState != null && emptyState.getParent() == root) {
                int index = root.indexOfChild(emptyState);
                root.removeView(emptyState);
                root.addView(scroll, index, new LinearLayout.LayoutParams(-1, 0, 1));
            }
            if (activeChatId.isEmpty()) {
                sendButton.setEnabled(false);
                network.execute(() -> {
                    try {
                        JSONObject body = new JSONObject();
                        if (!selectedModelId.isEmpty()) body.put("modelId", selectedModelId);
                body.put("modeId", selectedAgentMode);
                        if (!activeProjectId.isEmpty()) body.put("projectId", activeProjectId);
                        body.put("incognito", incognitoMode);
                        JSONObject chat = requestJson("/api/chats", "POST", body).optJSONObject("chat");
                        if (chat == null || chat.optString("id").isEmpty()) throw new Exception("No chat returned");
                        runOnUiThread(() -> {
                            activeChatId = chat.optString("id");
                            sendMessage(text, title, column, scroll);
                        });
                    } catch (Exception ex) {
                        runOnUiThread(() -> { sendButton.setEnabled(true); toastMessage(messageFor(ex)); });
                    }
                });
            } else sendMessage(text, title, column, scroll);
        });
        LinearLayout footerRow = new LinearLayout(this);
        footerRow.setGravity(Gravity.CENTER_VERTICAL);
        ImageView controls = icon("ellipsis", "Chat controls", 14);
        controls.setPadding(dp(7), 0, dp(7), 0);
        controls.setOnClickListener(v -> openChatControls(v));
        footerRow.addView(controls, new LinearLayout.LayoutParams(dp(30), dp(28)));
        contextFooter = label("", 10, MUTED);
        footerRow.addView(contextFooter, new LinearLayout.LayoutParams(0, dp(28), 1));
        root.addView(footerRow, new LinearLayout.LayoutParams(-1, dp(28)));
        updateContextFooter();
        loadUsage();
        setContentView(root);
        if (!emptyChat) scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    private void chatHeader(LinearLayout root) {
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(14), 0, dp(14), 0);

        ImageView navigation = icon("menu", "Open sidebar", 19);
        navigation.setContentDescription("Open sidebar");
        navigation.setOnClickListener(v -> openNavigation(v));
        bar.addView(navigation, new LinearLayout.LayoutParams(dp(44), dp(56)));

        modelButton = label(selectedModelName + "  ⌄", 14, FG);
        modelButton.setTypeface(webSemibold);
        modelButton.setGravity(Gravity.CENTER);
        modelButton.setSingleLine(true);
        modelButton.setEllipsize(TextUtils.TruncateAt.END);
        modelButton.setOnClickListener(v -> chooseModel());
        bar.addView(modelButton, new LinearLayout.LayoutParams(0, dp(56), 1));

        ImageView incognito = icon(incognitoMode ? "eye_off" : "eye", "Toggle incognito for new chats", 19);
        incognito.setContentDescription("Toggle incognito for new chats");
        incognito.setOnClickListener(v -> {
            if (!activeChatId.isEmpty()) {
                toastMessage(incognitoMode ? "Incognito chat" : "Incognito applies to new chats");
                return;
            }
            incognitoMode = !incognitoMode;
            incognito.setImageResource(incognitoMode ? R.drawable.ic_eye_off : R.drawable.ic_eye);
            toastMessage(incognitoMode ? "Incognito is on for new chats" : "Incognito is off");
        });
        bar.addView(incognito, new LinearLayout.LayoutParams(dp(44), dp(56)));

        ImageView workspaces = icon("panel_right", "Open workspace", 19);
        workspaces.setContentDescription("Open workspace");
        workspaces.setOnClickListener(v -> openWorkspaces());
        bar.addView(workspaces, new LinearLayout.LayoutParams(dp(44), dp(56)));

        root.addView(bar, new LinearLayout.LayoutParams(-1, dp(56)));
        View divider = new View(this);
        divider.setBackgroundColor(BORDER);
        root.addView(divider, new LinearLayout.LayoutParams(-1, dp(1)));
    }

    private String homeGreeting() {
        int hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
        String greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
        return currentUsername.isEmpty() ? greeting : greeting + ", " + currentUsername;
    }

    private void addMessageBubble(LinearLayout column, String role, String content) {
        boolean user = "user".equals(role);
        if (!user && containsBoard(content)) {
            column.addView(richContent(content), new LinearLayout.LayoutParams(-1, -2)); return;
        }
        TextView bubble = label(content, 15, FG);
        bubble.setTextIsSelectable(true);
        bubble.setLineSpacing(dp(2), 1.08f);
        if (!user && markdown != null) markdown.setMarkdown(bubble, content);
        bubble.setMaxWidth((int) (getResources().getDisplayMetrics().widthPixels * 0.86f));
        if (user) {
            bubble.setPadding(dp(14), dp(11), dp(14), dp(11));
            bubble.setBackground(background(SECONDARY, dp(10)));
        } else {
            bubble.setPadding(0, 0, 0, 0);
            bubble.setBackgroundColor(Color.TRANSPARENT);
        }
        LinearLayout line = new LinearLayout(this);
        line.setGravity(user ? Gravity.RIGHT : Gravity.LEFT);
        line.addView(bubble, new LinearLayout.LayoutParams(user ? -2 : -1, -2));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(user ? 16 : 18);
        column.addView(line, params);
    }

    private void sendMessage(String text, String title, LinearLayout column, ScrollView scroll) {
        composer.setText("");
        composer.setEnabled(false);
        busyRun = true;
        sendButton.setEnabled(true);
        setSendState(true);
        String displayText = text.isEmpty() && !pendingAttachments.isEmpty()
            ? "Dateien angehängt (" + pendingAttachments.size() + ")" : text;
        column.removeView(liveStatus);
        addMessageBubble(column, "user", displayText);
        column.addView(liveStatus);
        liveAssistantText = label("", 15, FG);
        liveAssistantText.setLineSpacing(dp(2), 1.08f);
        liveAssistantText.setPadding(0, 0, 0, 0);
        LinearLayout assistantLine = new LinearLayout(this);
        assistantLine.setGravity(Gravity.LEFT);
        assistantLine.addView(liveAssistantText, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout.LayoutParams assistantParams = new LinearLayout.LayoutParams(-1, -2);
        assistantParams.bottomMargin = dp(12);
        column.addView(assistantLine, column.indexOfChild(liveStatus), assistantParams);
        liveStatus.setText("Metis antwortet …");
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
        String chatId = activeChatId;

        network.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("chatId", chatId);
                body.put("message", text);
                body.put("messageId", UUID.randomUUID().toString());
                JSONArray attachmentPayload = readPendingAttachments();
                if (attachmentPayload.length() > 0) body.put("attachments", attachmentPayload);
                body.put("streamDeviceId", "android-" + UUID.randomUUID());
                JSONObject perModel = globalModelPreferences.optJSONObject("modelParamsByModel");
                JSONArray parameters = perModel == null ? null : perModel.optJSONArray(selectedModelId);
                if (parameters == null && selectedModelId.equals(globalModelPreferences.optString("modelId"))) parameters = globalModelPreferences.optJSONArray("modelParams");
                if (parameters != null) body.put("modelParams", parameters);
                if (!selectedModelId.isEmpty()) body.put("modelId", selectedModelId);
                body.put("modeId", selectedAgentMode);
                HttpURLConnection connection = openConnection("/api/chat", "POST", null);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                writeBody(connection, body.toString());
                int code = connection.getResponseCode();
                String response = readResponse(connection, code);
                connection.disconnect();
                if (code < 200 || code >= 300) throw apiError(response, code);
                if (!pendingAttachments.isEmpty()) {
                    pendingAttachments.clear();
                    runOnUiThread(() -> { if (composer != null) composer.setHint("Nachricht an Metis …"); });
                }
                JSONObject accepted = new JSONObject(response);
                String jobId = accepted.optString("jobId");
                if (jobId.isEmpty()) throw new Exception("Der Server hat keine Run-ID zurückgegeben.");

                long after = 0;
                boolean finished = false;
                StringBuilder answer = new StringBuilder();
                int polls = 0;
                while (!finished) {
                    String path = "/api/runs?chatId=" + encodePath(chatId)
                        + "&jobId=" + encodePath(jobId) + "&events=1&after=" + after;
                    JSONObject result = requestJson(path, "GET", null);
                    JSONArray events = result.optJSONArray("events");
                    if (events != null) {
                        for (int i = 0; i < events.length(); i++) {
                            JSONObject event = events.optJSONObject(i);
                            if (event == null) continue;
                            after = Math.max(after, event.optLong("id", 0));
                            JSONObject data = event.optJSONObject("data");
                            if (data == null) continue;
                            String kind = event.optString("event");
                            if ("text".equals(kind)) {
                                answer.append(data.optString("text", ""));
                                String partial = answer.toString();
                                runOnUiThread(() -> {
                                    if (chatId.equals(activeChatId) && liveAssistantText != null) {
                                        if (markdown != null) markdown.setMarkdown(liveAssistantText, partial);
                                        else liveAssistantText.setText(partial);
                                        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
                                    }
                                });
                            } else if ("text-reset".equals(kind)) {
                                answer.setLength(0);
                                runOnUiThread(() -> {
                                    if (chatId.equals(activeChatId) && liveAssistantText != null) liveAssistantText.setText("");
                                });
                            } else if ("thinking".equals(kind)) {
                                runOnUiThread(() -> {
                                    if (chatId.equals(activeChatId) && liveStatus != null) liveStatus.setText("Thinking…");
                                });
                            } else if ("status".equals(kind)) {
                                String status = data.optString("message", data.optString("status", "Metis arbeitet …"));
                                runOnUiThread(() -> {
                                    if (chatId.equals(activeChatId) && liveStatus != null) liveStatus.setText(status);
                                });
                            } else if ("question".equals(kind)) {
                                showPendingQuestion(data);
                                runOnUiThread(() -> {
                                    if (chatId.equals(activeChatId) && liveStatus != null) liveStatus.setText("Metis wartet auf deine Antwort");
                                });
                            } else if ("tool".equals(kind)) {
                                String tool = data.optString("name", "Metis arbeitet");
                                String state = data.optString("status", "wird ausgeführt");
                                runOnUiThread(() -> {
                                    if (chatId.equals(activeChatId) && liveStatus != null) {
                                        liveStatus.setText(tool + " · " + state);
                                        if (!"started".equals(state)) addToolCard(column, data);
                                    }
                                });
                            } else if ("done".equals(kind)) {
                                finished = true;
                            } else if ("error".equals(kind)) {
                                throw new Exception(data.optString("message", "Agent-Run fehlgeschlagen."));
                            }
                        }
                    }
                    JSONObject job = null;
                    if (++polls % 10 == 0) {
                        JSONArray jobs = requestJson("/api/runs?chatId=" + encodePath(chatId), "GET", null).optJSONArray("jobs");
                        if (jobs != null) for (int i = 0; i < jobs.length(); i++) {
                            JSONObject candidate = jobs.optJSONObject(i);
                            if (candidate != null && jobId.equals(candidate.optString("id"))) { job = candidate; break; }
                        }
                        JSONObject chat = requestJson("/api/chats/" + encodePath(chatId), "GET", null).optJSONObject("chat");
                        JSONObject approval = chat == null ? null : chat.optJSONObject("pendingApproval");
                        if (approval != null) runOnUiThread(() -> { if (chatId.equals(activeChatId)) showApproval(approval); });
                    }
                    if (job != null) {
                        String state = job.optString("status");
                        if ("failed".equals(state) || "error".equals(state) || "interrupted".equals(state)) throw new Exception(job.optString("error", "Run failed"));
                        if ("completed".equals(state) || "cancelled".equals(state) || "canceled".equals(state)) finished = true;
                    }
                    if (!finished) Thread.sleep(600);
                }
                runOnUiThread(() -> {
                    if (!chatId.equals(activeChatId)) return;
                    liveStatus.setText("");
                    busyRun = false;
                    composer.setEnabled(true);
                    setSendState(false);
                    sendButton.setEnabled(true);
                    composer.requestFocus();
                    openChat(chatId, title);
                });
            } catch (Exception ex) {
                runOnUiThread(() -> {
                    if (!chatId.equals(activeChatId)) return;
                    if (liveStatus != null) liveStatus.setText(messageFor(ex));
                    busyRun = false;
                    if (composer != null) composer.setEnabled(true);
                    if (sendButton != null) { setSendState(false); sendButton.setEnabled(true); }
                });
            }
        });
    }

    private void showPendingQuestion(JSONObject data) {
        runOnUiThread(() -> {
            JSONArray questions = data.optJSONArray("questions");
            String questionId = data.optString("questionId");
            if (questions == null || questions.length() == 0 || questionId.isEmpty() || questionId.equals(displayedQuestionId)) return;
            displayedQuestionId = questionId;
            String questionChatId = activeChatId;
            LinearLayout form = new LinearLayout(this);
            form.setOrientation(LinearLayout.VERTICAL);
            form.setPadding(dp(20), dp(8), dp(20), 0);
            ArrayList<EditText> answers = new ArrayList<>();
            ArrayList<ArrayList<android.widget.CompoundButton>> choices = new ArrayList<>();
            ArrayList<Boolean> multiples = new ArrayList<>();
            for (int i = 0; i < questions.length(); i++) {
                JSONObject question = questions.optJSONObject(i);
                if (question == null) return;
                TextView prompt = label(question.optString("question"), 14, FG);
                prompt.setPadding(0, dp(8), 0, dp(6)); form.addView(prompt);
                boolean multiple = question.optBoolean("multiple");
                multiples.add(multiple);
                ArrayList<android.widget.CompoundButton> fields = new ArrayList<>();
                JSONArray options = question.optJSONArray("options");
                android.widget.RadioGroup radio = multiple ? null : new android.widget.RadioGroup(this);
                if (radio != null) form.addView(radio);
                if (options != null) for (int j = 0; j < options.length(); j++) {
                    Object option = options.opt(j);
                    JSONObject record = option instanceof JSONObject ? (JSONObject) option : null;
                    String title = record == null ? String.valueOf(option) : record.optString("label");
                    String value = record == null ? title : record.optString("value", title);
                    android.widget.CompoundButton field = multiple ? new android.widget.CheckBox(this) : new android.widget.RadioButton(this);
                    field.setId(View.generateViewId()); field.setText(title); field.setTag(value);
                    field.setTextColor(FG); field.setTextSize(13); field.setTypeface(webRegular);
                    if (multiple) form.addView(field); else radio.addView(field);
                    fields.add(field);
                }
                choices.add(fields);
                EditText answer = input(options == null || options.length() == 0 ? "Your answer" : "Or enter your own answer", false);
                form.addView(answer, new LinearLayout.LayoutParams(-1, -2));
                answers.add(answer);
            }
            ScrollView scroll = new ScrollView(this); scroll.addView(form);
            AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Metis has a question")
                .setView(scroll).setNegativeButton("Close", null).setPositiveButton("Send answer", null).create();
            dialog.setOnDismissListener(d -> displayedQuestionId = "");
            dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                JSONArray values = new JSONArray();
                for (int i = 0; i < answers.size(); i++) {
                    String value = answers.get(i).getText().toString().trim();
                    if (value.isEmpty()) {
                        JSONArray selected = new JSONArray();
                        for (android.widget.CompoundButton field : choices.get(i)) if (field.isChecked()) selected.put(field.getTag().toString());
                        if (selected.length() > 0) value = multiples.get(i) ? selected.toString() : selected.optString(0);
                    }
                    if (value.isEmpty()) { answers.get(i).setError("Please answer"); return; }
                    values.put(value);
                }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                network.execute(() -> {
                    try {
                        JSONObject body = new JSONObject().put("questionId", questionId).put("answers", values);
                        if (data.has("version")) body.put("version", data.optInt("version"));
                        requestJson("/api/chat/answer", "POST", body);
                        runOnUiThread(() -> { dialog.dismiss(); if (questionChatId.equals(activeChatId)) openChat(questionChatId, "Chat"); });
                    } catch (Exception ex) { runOnUiThread(() -> {
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                        toastMessage(messageFor(ex));
                    }); }
                });
            }));
            dialog.show();
        });
    }

    private void openChatControls(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add("Choose model").setOnMenuItemClickListener(item -> { chooseModel(); return true; });
        menu.getMenu().add("Agent mode").setOnMenuItemClickListener(item -> { chooseAgentMode(); return true; });
        menu.getMenu().add("Workspace").setOnMenuItemClickListener(item -> { openWorkspaces(); return true; });
        menu.getMenu().add("Chat logs").setOnMenuItemClickListener(item -> { showChatLogs(); return true; });
        menu.getMenu().add("Settings").setOnMenuItemClickListener(item -> { showSettings(); return true; });
        if (!activeChatId.isEmpty() && !incognitoMode) menu.getMenu().add("Share chat").setOnMenuItemClickListener(item -> {
            showShareChat(); return true;
        });
        menu.show();
    }

    private void chooseAgentMode() {
        String chatId = activeChatId;
        network.execute(() -> {
            try {
                JSONArray modes = requestJson("/api/modes", "GET", null).optJSONArray("modes");
                if (modes == null || modes.length() == 0) throw new Exception("No agent modes available");
                String[] names = new String[modes.length()];
                int selected = -1;
                for (int i = 0; i < modes.length(); i++) {
                    JSONObject mode = modes.optJSONObject(i);
                    names[i] = mode == null ? "Mode" : mode.optString("name");
                    if (mode != null && selectedAgentMode.equals(mode.optString("id"))) selected = i;
                }
                int checked = selected;
                runOnUiThread(() -> new AlertDialog.Builder(this).setTitle("Agent mode")
                    .setSingleChoiceItems(names, checked, (dialog, which) -> {
                        JSONObject mode = modes.optJSONObject(which);
                        if (mode == null) return;
                        String next = mode.optString("id");
                        if (chatId.isEmpty()) { selectedAgentMode = next; dialog.dismiss(); return; }
                        network.execute(() -> {
                            try {
                                JSONObject chat = requestJson("/api/chats/" + encodePath(chatId), "GET", null).optJSONObject("chat");
                                JSONObject session = chat == null ? null : chat.optJSONObject("sessionState");
                                if (session == null) session = new JSONObject();
                                session.put("modeId", next);
                                requestJson("/api/chats/" + encodePath(chatId), "PATCH", new JSONObject().put("sessionState", session));
                                runOnUiThread(() -> { if (chatId.equals(activeChatId)) selectedAgentMode = next; dialog.dismiss(); });
                            } catch (Exception ex) { runOnUiThread(() -> toastMessage(messageFor(ex))); }
                        });
                    }).setNegativeButton("Close", null).show());
            } catch (Exception ex) { runOnUiThread(() -> toastMessage(messageFor(ex))); }
        });
    }

    private void showShareChat() {
        final String chatId = activeChatId;
        if (chatId.isEmpty() || incognitoMode) return;
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(20), dp(12), dp(20), dp(12));
        form.addView(label("Create a link that other people can open to read this chat.", 14, MUTED));
        EditText password = input("Optional password", true);
        form.addView(password);
        TextView link = label("", 13, FG); link.setTextIsSelectable(true); form.addView(link);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Share chat").setView(form)
            .setNegativeButton("Close", null).setPositiveButton("Create link", null).setNeutralButton("Disable link", null).create();
        dialog.setOnShowListener(d -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                String secret = password.getText().toString();
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                network.execute(() -> {
                    try {
                        JSONObject body = new JSONObject().put("active", true);
                        body.put("password", secret.isEmpty() ? JSONObject.NULL : secret);
                        JSONObject share = requestJson("/api/chats/" + encodePath(chatId) + "/share", "PATCH", body).optJSONObject("share");
                        if (share == null) throw new Exception("No share link returned");
                        String url = serverUrl + "/share?id=" + encodePath(share.optString("id"));
                        runOnUiThread(() -> {
                            link.setText(url);
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setText("Share link");
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(x -> {
                                Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url);
                                startActivity(Intent.createChooser(intent, "Share chat"));
                            });
                        });
                    } catch (Exception ex) { runOnUiThread(() -> {
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                        link.setText(messageFor(ex));
                    }); }
                });
            });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> network.execute(() -> {
                try {
                    requestJson("/api/chats/" + encodePath(chatId) + "/share", "PATCH", new JSONObject().put("active", false));
                    runOnUiThread(() -> { link.setText("Link disabled"); dialog.dismiss(); });
                } catch (Exception ex) { runOnUiThread(() -> link.setText(messageFor(ex))); }
            }));
        });
        dialog.show();
    }

    private void setSendState(boolean stopping) {
        if (sendButton == null) return;
        android.graphics.drawable.Drawable glyph = getDrawable(stopping ? R.drawable.ic_square : R.drawable.ic_arrow_up);
        glyph.setBounds(0, 0, dp(18), dp(18));
        glyph.setTint(FG);
        sendButton.setText("");
        sendButton.setCompoundDrawables(glyph, null, null, null);
        sendButton.setGravity(Gravity.CENTER);
        sendButton.setContentDescription(stopping ? "Stop agent" : "Send");
    }

    private void addToolCard(LinearLayout column, JSONObject tool) {
        String name = tool.optString("name", "Tool");
        String status = tool.optString("status", "");
        TextView card = label(name + (status.isEmpty() ? "" : " · " + status), 12, MUTED);
        card.setPadding(dp(10), dp(8), dp(10), dp(8));
        card.setBackground(outlinedSurface(SURFACE, dp(8)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(6);
        int index = liveStatus != null && liveStatus.getParent() == column ? column.indexOfChild(liveStatus) : column.getChildCount();
        column.addView(card, index, params);
        card.setOnClickListener(v -> showToolDetails(tool));

    }


    private void showSettings() {
        if (sidebarDialog != null) dismissSidebar();
        new NativeSettings(this, this::requestJson, network, serverUrl, () -> network.execute(this::loadModels)).open();
    }

    private void startVoice() {
        if (voice != null) voice.close();
        final EditText target = composer;
        final String chatId = activeChatId;
        voice = new NativeVoice(this, network, (path, method) -> openConnection(path, method, null), text -> {
            if (composer != target || !chatId.equals(activeChatId)) {
                new AlertDialog.Builder(this).setTitle("Transcription").setMessage(text)
                    .setPositiveButton("Copy", (d,w) -> copyText(text)).setNegativeButton("Close", null).show();
                return;
            }
            String draft = target.getText().toString();
            target.setText(draft + (draft.isEmpty() ? "" : " ") + text);
            target.setSelection(target.length());
        });
        NativeVoice current = voice;
        network.execute(() -> {
            try {
                JSONObject data = requestJson("/api/preferences", "GET", null);
                JSONObject settings = data.optJSONObject("settings");
                JSONObject flags = settings == null ? null : settings.optJSONObject("featureFlags");
                JSONObject config = settings == null ? null : settings.optJSONObject("voiceInput");
                if (config == null) config = new JSONObject();
                final JSONObject snapshot = config;
                boolean enabled = flags == null || flags.optBoolean("voiceInput", true);
                runOnUiThread(() -> { if (voice != current) return; if (!enabled) toastMessage("Voice input is disabled in Settings"); else current.start(snapshot, chatId); });
            } catch (Exception ex) { runOnUiThread(() -> toastMessage(messageFor(ex))); }
        });
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == NativeVoice.PERMISSION && voice != null) voice.permissionResult(grants);
    }

    private boolean containsBoard(String content) {
        return java.util.regex.Pattern.compile("(?m)^`{3,}(graph|jsxgraph|geogebra|plot|chart|charts)\\s*\\n").matcher(content).find();
    }

    private LinearLayout richContent(String source) {
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile("(?ms)^(`{3,})(graph|jsxgraph|geogebra|plot|chart|charts)[ \\t]*\\n(.*?)^\\1[ \\t]*$");
        java.util.regex.Matcher match = pattern.matcher(source);
        int after = 0;
        while (match.find()) {
            addMarkdown(content, source.substring(after, match.start()));
            String raw = match.group(3);
            try {
                Object parsed = new org.json.JSONTokener(raw).nextValue();
                boolean chart = match.group(2).startsWith("chart");
                JSONObject document = parsed instanceof JSONObject ? (JSONObject) parsed : null;
                if (!chart && document != null && (document.has("series") || document.has("values") || document.has("charts")) && !document.has("elements")) chart = true;
                JSONArray boards = parsed instanceof JSONArray ? (JSONArray) parsed
                    : document == null ? null : document.optJSONArray(chart ? "charts" : "boards");
                if (boards == null) boards = new JSONArray().put(parsed);
                if (boards.length() > 20) throw new Exception("Too many boards");
                for (int i = 0; i < boards.length(); i++) {
                    NativeBoard board = new NativeBoard(this, boards.getJSONObject(i), chart);
                    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.setMargins(0, dp(8), 0, dp(12));
                    content.addView(board, params);
                }
            } catch (Exception ex) {
                content.addView(label("Graph could not be rendered: " + ex.getMessage(), 12, Color.rgb(248,113,113)));
                addMarkdown(content, "```json\n" + raw + "\n```");
            }
            after = match.end();
        }
        addMarkdown(content, source.substring(after)); return content;
    }

    private void addMarkdown(LinearLayout content, String text) {
        if (text.trim().isEmpty()) return;
        TextView view = label("", 15, FG); view.setTextIsSelectable(true);
        markdown.setMarkdown(view, text); content.addView(view);
    }

    private void copyText(String value) {
        android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Metis", value)); toastMessage("Copied");
    }

    private String payload(Object value) {
        if (value == null || value == JSONObject.NULL) return "";
        try { if (value instanceof JSONObject) return ((JSONObject) value).toString(2);
            if (value instanceof JSONArray) return ((JSONArray) value).toString(2); } catch (Exception ignored) {}
        return value.toString();
    }

    private void toolSection(LinearLayout form, String title, Object value) {
        String text = payload(value); if (text.isEmpty()) return;
        TextView heading = label(title.toUpperCase(java.util.Locale.US), 10, MUTED); heading.setPadding(0, dp(14), 0, dp(4)); form.addView(heading);
        TextView code = label(text, 12, FG); code.setTypeface(Typeface.MONOSPACE); code.setTextIsSelectable(true);
        form.addView(code); code.setOnLongClickListener(v -> { copyText(text); return true; });
    }

    private void showToolDetails(JSONObject tool) {
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(16), dp(8), dp(16), dp(16));
        form.addView(label(tool.optString("kind") + " · " + tool.optString("status"), 12, MUTED));
        toolSection(form, "Input", tool.opt("input")); toolSection(form, "Result", tool.opt("output"));
        toolSection(form, "Detail", tool.opt("detail")); toolSection(form, "Result", tool.opt("result"));
        toolSection(form, "Error", tool.opt("error")); toolSection(form, "Path", tool.opt("path"));
        String messageId = tool.optString("_messageId"), toolId = tool.optString("id"), chatId = activeChatId;
        JSONObject diff = tool.optJSONObject("diff");
        if (diff != null || (!messageId.isEmpty() && !toolId.isEmpty() && "edit".equals(tool.optString("kind")))) {
            Button show = button("Open diff"); form.addView(show);
            show.setOnClickListener(v -> {
                if (diff != null && (diff.has("before") || diff.has("after"))) { showDiff(diff); return; }
                network.execute(() -> {
                    try { JSONObject result = requestJson("/api/chats/" + encodePath(chatId) + "/tool-diff?messageId=" + encodePath(messageId) + "&toolId=" + encodePath(toolId), "GET", null);
                        runOnUiThread(() -> showDiff(result.optJSONObject("diff")));
                    } catch (Exception ex) { runOnUiThread(() -> toastMessage(messageFor(ex))); }
                });
            });
        }
        if (form.getChildCount() == 1) toolSection(form, "Details", tool);
        ScrollView scroll = new ScrollView(this); scroll.addView(form);
        new AlertDialog.Builder(this).setTitle(tool.optString("name", "Tool")).setView(scroll)
            .setPositiveButton("Close", null).setNeutralButton("Copy", (d,w) -> copyText(payload(tool))).show();
    }

    private void showDiff(JSONObject diff) {
        if (diff == null) return;
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(14), dp(8), dp(14), dp(12));
        for (String side : new String[]{"before", "after"}) {
            TextView title = label(side.equals("before") ? "BEFORE" : "AFTER", 11, MUTED); form.addView(title);
            TextView source = label(diff.optString(side, "(missing)"), 12, side.equals("before") ? Color.rgb(248,113,113) : Color.rgb(74,222,128));
            source.setTypeface(Typeface.MONOSPACE); source.setTextIsSelectable(true); form.addView(source);
        }
        ScrollView scroll = new ScrollView(this); scroll.addView(form);
        new AlertDialog.Builder(this).setTitle(diff.optString("path","File diff")).setView(scroll)
            .setPositiveButton("Close",null).setNeutralButton("Copy", (d,w)->copyText(payload(diff))).show();
    }

    private void showChatLogs() {
        if (activeChatId.isEmpty()) { toastMessage("Open a chat first"); return; }
        final String chatId = activeChatId;
        network.execute(() -> {
            try {
                JSONObject data = requestJson("/api/chats/" + encodePath(chatId) + "/logs", "GET", null);
                JSONArray logs = data.optJSONArray("logs");
                if (logs == null) { JSONObject document = data.optJSONObject("logs"); logs = document == null ? null : document.optJSONArray("entries"); }
                final JSONArray entries = logs == null ? new JSONArray() : logs;
                runOnUiThread(() -> {
                    LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(14), dp(8), dp(14), dp(12));
                    EditText query = input("Filter logs…", false); form.addView(query);
                    LinearLayout results = new LinearLayout(this); results.setOrientation(LinearLayout.VERTICAL);
                    ScrollView scroll = new ScrollView(this); scroll.addView(results); form.addView(scroll,new LinearLayout.LayoutParams(-1,dp(400)));
                    Runnable render = () -> {
                        results.removeAllViews(); String filter = query.getText().toString().toLowerCase(java.util.Locale.ROOT);
                        for (int i = entries.length()-1; i >= 0; i--) { JSONObject entry = entries.optJSONObject(i); if (entry == null) continue;
                            if (!entry.toString().toLowerCase(java.util.Locale.ROOT).contains(filter)) continue;
                            TextView row = label(entry.optString("category")+" · "+entry.optString("title")+"\n"+entry.optString("timestamp"), 12, MUTED);
                            row.setPadding(0,dp(10),0,dp(10)); results.addView(row);
                            row.setOnClickListener(v -> {LinearLayout details=new LinearLayout(this);details.setOrientation(1);details.setPadding(dp(14),dp(10),dp(14),dp(10));toolSection(details,"Content",entry.opt("content"));toolSection(details,"Metadata",entry.opt("metadata"));ScrollView view=new ScrollView(this);view.addView(details);new AlertDialog.Builder(this).setTitle(entry.optString("title")).setView(view).setPositiveButton("Close",null).setNeutralButton("Copy",(d,w)->copyText(payload(entry))).show();});
                        }
                    };
                    query.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int n){} public void onTextChanged(CharSequence s,int a,int b,int c){render.run();}public void afterTextChanged(android.text.Editable e){}});
                    render.run(); new AlertDialog.Builder(this).setTitle("Chat logs").setView(form).setPositiveButton("Close",null).show();
                });
            } catch (Exception ex) { runOnUiThread(() -> toastMessage(messageFor(ex))); }
        });
    }

    private String tokenCount(long value) {
        if (value >= 1000000) return String.format(java.util.Locale.US, "%.2fM", value / 1000000d);
        if (value >= 1000) return String.format(java.util.Locale.US, "%.1fK", value / 1000d);
        return Long.toString(value);
    }

    private void updateContextFooter() {
        if (contextFooter == null) return;
        long total = 0, used = 0;
        JSONObject selected = null;
        for (int i = 0; i < availableModels.length(); i++) {
            JSONObject model = availableModels.optJSONObject(i);
            if (model != null && selectedModelId.equals(model.optString("id"))) { selected = model; total = model.optLong("contextWindow"); break; }
        }
        boolean measured = false;
        for (int i = conversationMessages.length() - 1; i >= 0; i--) {
            JSONObject message = conversationMessages.optJSONObject(i);
            JSONObject meta = message == null ? null : message.optJSONObject("runMetadata");
            if (meta == null || (!meta.optString("modelId").isEmpty() && !selectedModelId.equals(meta.optString("modelId")))) continue;
            if (meta.has("contextUsedTokens")) { used = meta.optLong("contextUsedTokens"); measured = true; break; }
            if (meta.has("inputTokens")) { used = meta.optLong("inputTokens"); measured = true; break; }
        }
        if (!measured) for (int i = 0; i < conversationMessages.length(); i++) {
            JSONObject message = conversationMessages.optJSONObject(i);
            if (message != null) used += (message.optString("content").length() + 3) / 4;
        }
        String usage = "—";
        String providerId = selected == null ? "" : selected.optString("providerId").toLowerCase(java.util.Locale.ROOT);
        String connectionId = selected == null ? "" : selected.optString("connectionId");
        JSONArray providers = usageSnapshot.optJSONArray("providers");
        if (providers != null) for (int i = 0; i < providers.length(); i++) {
            JSONObject provider = providers.optJSONObject(i);
            if (provider == null) continue;
            boolean match = !connectionId.isEmpty() ? connectionId.equals(provider.optString("connectionId"))
                : !providerId.isEmpty() && providerId.equals(provider.optString("key"));
            if (!match) continue;
            JSONArray windows = provider.optJSONArray("windows");
            double max = -1;
            if (windows != null) for (int j = 0; j < windows.length(); j++) {
                JSONObject window = windows.optJSONObject(j);
                if (window != null && !window.isNull("usedPercent")) max = Math.max(max, window.optDouble("usedPercent", -1));
            }
            if (max >= 0) usage = Math.round(Math.max(0, Math.min(100, 100 - max))) + "%";
            if ("stale".equals(provider.optString("status"))) usage += " · cached";
            break;
        }
        contextFooter.setGravity(Gravity.CENTER_VERTICAL);
        contextFooter.setText("Context  " + (measured || used == 0 ? "" : "~") + tokenCount(used)
            + " / " + (total > 0 ? tokenCount(total) : "—") + "   Usage  " + usage);
    }

    private void loadUsage() {
        network.execute(() -> {
            try {
                JSONObject snapshot = requestJson("/api/plan-usage", "GET", null);
                runOnUiThread(() -> { usageSnapshot = snapshot; updateContextFooter(); });
            } catch (Exception ignored) { /* Unavailable quotas stay visibly unknown. */ }
        });
    }

    private void openWorkspaces() {
        if (activeChatId.isEmpty()) {
            new AlertDialog.Builder(this).setTitle("Workspace").setMessage("No workspaces in this chat yet.")
                .setPositiveButton("Close", null).show(); return;
        }
        String chatId = activeChatId;
        network.execute(() -> {
            try {
                JSONObject chat = requestJson("/api/chats/" + encodePath(chatId), "GET", null).optJSONObject("chat");
                JSONArray items = chat == null ? null : chat.optJSONArray("workspaces");
                runOnUiThread(() -> {
                    if (!chatId.equals(activeChatId)) return;
                    if (items == null || items.length() == 0) {
                        new AlertDialog.Builder(this).setTitle("Workspace").setMessage("No workspaces in this chat yet.")
                            .setPositiveButton("Close", null).show(); return;
                    }
                    String[] names = new String[items.length()];
                    for (int i = 0; i < names.length; i++) {
                        JSONObject item = items.optJSONObject(i);
                        names[i] = item == null ? "Workspace" : item.optString("name", "Untitled");
                    }
                    new AlertDialog.Builder(this).setTitle("Workspace").setItems(names, (d, which) -> editWorkspace(chatId, items.optJSONObject(which)))
                        .setNegativeButton("Close", null).show();
                });
            } catch (Exception ex) { runOnUiThread(() -> toastMessage(messageFor(ex))); }
        });
    }

    private void editWorkspace(String chatId, JSONObject item) {
        if (item == null) return;
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(16), dp(12), dp(16), dp(12));
        String source = item.optString("content");
        if (("graph".equals(item.optString("kind")) || "graph".equals(item.optString("type"))) && !source.contains("```"))
            source = "```graph\n" + source + "\n```";
        if (("chart".equals(item.optString("kind")) || "chart".equals(item.optString("type"))) && !source.contains("```"))
            source = "```chart\n" + source + "\n```";
        ScrollView scroll = new ScrollView(this); scroll.addView(richContent(source));
        form.addView(scroll, new LinearLayout.LayoutParams(-1, dp(300)));
        AlertDialog view = new AlertDialog.Builder(this).setTitle(item.optString("name", "Workspace"))
            .setView(form).setNegativeButton("Close", null).setPositiveButton("Edit", (d, w) -> {
                EditText content = input("Content", false); content.setSingleLine(false);
                content.setText(item.optString("content"));
                AlertDialog editor = new AlertDialog.Builder(this).setTitle(item.optString("name"))
                    .setView(content).setNegativeButton("Cancel", null).setPositiveButton("Save", null).create();
                editor.setOnShowListener(ignored -> editor.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                    editor.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                    String value = content.getText().toString();
                    network.execute(() -> {
                        try {
                            JSONObject body = new JSONObject().put("chatId", chatId).put("id", item.optString("id"))
                                .put("version", item.optInt("version", 1)).put("content", value);
                            requestJson("/api/workspaces", "PATCH", body);
                            runOnUiThread(() -> { editor.dismiss(); toastMessage("Saved"); });
                        } catch (Exception ex) { runOnUiThread(() -> {
                            editor.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                            content.setError(messageFor(ex));
                        }); }
                    });
                }));
                editor.show();
            }).create();
        view.show();
    }

    private void showApproval(JSONObject approval) {
        String approvalId = approval.optString("id");
        if (approvalId.isEmpty() || approvalId.equals(displayedApprovalId)) return;
        displayedApprovalId = approvalId;
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(approval.optString("title", "Approval required"))
            .setMessage(approval.optString("command", approval.optString("detail", "")))
            .setPositiveButton("Allow", null).setNeutralButton("Allow for session", null)
            .setNegativeButton("Deny", null).create();
        dialog.setOnDismissListener(d -> displayedApprovalId = "");
        dialog.setOnShowListener(d -> {
            int[] buttons = {AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEUTRAL, AlertDialog.BUTTON_NEGATIVE};
            String[] decisions = {"allow", "allow-session", "deny"};
            for (int i = 0; i < buttons.length; i++) {
                String decision = decisions[i];
                dialog.getButton(buttons[i]).setOnClickListener(v -> {
                    for (int button : buttons) dialog.getButton(button).setEnabled(false);
                    network.execute(() -> {
                        try {
                            JSONObject body = new JSONObject().put("approvalId", approvalId).put("decision", decision);
                            if (approval.has("version")) body.put("version", approval.optInt("version"));
                            requestJson("/api/chat/approval", "POST", body);
                            runOnUiThread(dialog::dismiss);
                        } catch (Exception ex) {
                            runOnUiThread(() -> {
                                for (int button : buttons) dialog.getButton(button).setEnabled(true);
                                toastMessage(messageFor(ex));
                            });
                        }
                    });
                });
            }
        });
        dialog.show();
    }

    private void pickAttachments() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(intent, PICK_ATTACHMENTS);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == NativeVoice.SPEECH && voice != null) { voice.speechResult(resultCode, data); return; }
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_ATTACHMENTS || resultCode != RESULT_OK || data == null) return;
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount() && pendingAttachments.size() < 10; i++) {
                Uri uri = data.getClipData().getItemAt(i).getUri();
                if (!pendingAttachments.contains(uri)) pendingAttachments.add(uri);
            }
        } else if (data.getData() != null && !pendingAttachments.contains(data.getData())) {
            pendingAttachments.add(data.getData());
        }
        if (pendingAttachments.size() >= 10) toastMessage("Maximal 10 Dateien pro Nachricht.");
        if (composer != null) composer.setHint(pendingAttachments.isEmpty()
            ? "Nachricht an Metis …" : pendingAttachments.size() + " Datei(en) angehängt · Nachricht an Metis …");
    }

    private JSONArray readPendingAttachments() throws Exception {
        JSONArray result = new JSONArray();
        for (Uri uri : new ArrayList<>(pendingAttachments)) {
            String name = "Datei";
            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (column >= 0) name = cursor.getString(column);
                }
            }
            String mime = getContentResolver().getType(uri);
            if (mime == null) mime = "application/octet-stream";
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) throw new Exception("Datei kann nicht geöffnet werden: " + name);
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 50 * 1024 * 1024) throw new Exception("Datei zu groß (max. 50 MB): " + name);
                    bytes.write(buffer, 0, count);
                }
            }
            JSONObject item = new JSONObject();
            item.put("name", name);
            item.put("mimeType", mime);
            item.put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
            result.put(item);
        }
        return result;
    }

    private void cancelRun(String chatId) {
        if (chatId == null || chatId.isEmpty()) return;
        sendButton.setEnabled(false);
        liveStatus.setText("Antwort wird gestoppt …");
        network.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("chatId", chatId);
                requestJson("/api/chat/cancel", "POST", body);
            } catch (Exception ex) {
                runOnUiThread(() -> toastMessage(messageFor(ex)));
            }
        });
    }

    private void logout() {
        network.execute(() -> {
            try { requestJson("/api/auth", "DELETE", null); } catch (Exception ignored) {}
            sessionCookie = "";
            currentUsername = "";
            incognitoMode = false;
            getPreferences(MODE_PRIVATE).edit().remove(SESSION).remove(USERNAME).apply();
            runOnUiThread(() -> showLogin(""));
        });
    }

    private HttpURLConnection openConnection(String path, String method, String ignored) throws Exception {
        URL url = new URL(serverUrl + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-Metis-Device-Id", "metis-android");
        if (!sessionCookie.isEmpty()) connection.setRequestProperty("Cookie", sessionCookie);
        return connection;
    }

    private void writeBody(HttpURLConnection connection, String body) throws Exception {
        byte[] data = body.getBytes(StandardCharsets.UTF_8);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(data);
        }
    }

    private String readResponse(HttpURLConnection connection, int code) throws Exception {
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private JSONObject requestJson(String path, String method, JSONObject body) throws Exception {
        HttpURLConnection connection = openConnection(path, method, null);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            writeBody(connection, body.toString());
        }
        int code = connection.getResponseCode();
        String response = readResponse(connection, code);
        connection.disconnect();
        if (code < 200 || code >= 300) throw apiError(response, code);
        return response.isEmpty() ? new JSONObject() : new JSONObject(response);
    }

    private Exception apiError(String response, int code) {
        try {
            String message = new JSONObject(response).optString("error");
            if (!message.isEmpty()) return new Exception(message);
        } catch (Exception ignored) {}
        return new Exception("Serverfehler (HTTP " + code + ")");
    }

    private boolean isUnauthorized(Exception ex) {
        return ex.getMessage() != null && ex.getMessage().contains("Unauthorized");
    }

    private String messageFor(Exception ex) {
        if (ex instanceof java.net.UnknownHostException) return "Server nicht gefunden. Prüfe die Serveradresse.";
        if (ex instanceof java.net.ConnectException) return "Verbindung zum Metis-Server nicht möglich.";
        return ex.getMessage() == null ? "Verbindung fehlgeschlagen." : ex.getMessage();
    }

    private String encodePath(String value) throws Exception {
        return URLEncoder.encode(value, "UTF-8");
    }

    private GradientDrawable background(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(radius);
        return shape;
    }

    private GradientDrawable outlinedSurface(int color, int radius) {
        GradientDrawable shape = background(color, radius);
        shape.setStroke(dp(1), BORDER);
        return shape;
    }

    private void toastMessage(String text) {
        android.widget.Toast.makeText(this, text, android.widget.Toast.LENGTH_LONG).show();
    }

    @Override public void onBackPressed() {
        if (!activeChatId.isEmpty()) {
            activeChatId = "";
            loadChatList();
        } else {
            super.onBackPressed();
        }
    }

    @Override protected void onStop() {
        if (voice != null) voice.backgrounded();
        super.onStop();
    }

    @Override protected void onDestroy() {
        if (voice != null) voice.close();
        network.shutdownNow();
        super.onDestroy();
    }
}
