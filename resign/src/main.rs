// 暗記（自作の殻・無料署名）を期限の前に入れ直す。
// iloader 2.4.2 と同じ部品（isideload）・同じ保存先（Windows の資格情報 "iloader"）を使うので、
// iloader で一度ログインした「この PC」の扱い・署名の鍵をそのまま使い回す。
//
//   selfanki_resign.exe              期限が近ければ入れ直す（タスクから呼ぶ用。2FA が要れば失敗として知らせる）
//   selfanki_resign.exe --force      期限に関係なく今すぐ入れ直す
//   selfanki_resign.exe --check      端末が見えるか・パスワードと IPA があるかだけ見る（Apple にはつながない・state.json は書かない）
//   --interactive                    確認コードを聞かれたらこの窓で打てるようにする
//   --wifi                           USB がつながっていても Wi-Fi の接続だけを使う（試験用）
//
// 置き場: exe と同じフォルダの config.json・state.json・resign.log
// 入れ直す端末: config.json の udid があればそれ。無ければ、最初に入れ直せた端末を state.json に覚え、以後はその端末だけ
// （別の端末に入れてしまわないように。端末を替えるときは state.json の udid を消すか、config.json に書く）

use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use idevice::usbmuxd::{Connection, UsbmuxdAddr, UsbmuxdConnection};
use isideload::{
    anisette::{AnisetteClientInfo, remote_v3::RemoteV3AnisetteProvider},
    auth::apple_account::{AppleAccount, TwoFactorCallbackParams, TwoFactorCallbackResponse},
    dev::developer_session::DeveloperSession,
    sideload::{
        SideloaderBuilder,
        builder::{ExtensionsBehavior, ExtensionsBehaviorSelection, MaxCertsBehavior},
    },
    util::{
        callbacks::{ExtensionsBehaviorCallbackBox, MaxCertsCallbackBox},
        keyring_storage::KeyringStorage,
    },
};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "iloader";

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct Config {
    udid: String,
    ipa: String,
    anisette_url: String,
    /// 前回うまくいってから何時間たったら入れ直すか（署名は 168 時間で切れる）
    min_age_hours: f64,
    /// 失敗したあと、次に Apple へ試すまで空ける時間
    retry_after_fail_hours: f64,   // 続けて失敗するたびに倍にする（上限 24 時間）
    /// 空なら資格情報の「*.iloader」から Apple ID を探す
    email: String,
    /// Apple に名乗る端末の情報（iloader 2.4.2 の値）。Apple が受け付けなくなったら、iloader の新しい版の値に合わせる
    anisette_client_info: String,
    anisette_user_agent: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            udid: String::new(),   // 空なら、つながっている端末が1台だけのときそれを使う
            ipa: "SelfAnki.ipa".into(),
            anisette_url: "https://mac-ani.jkcoxson.com".into(),
            min_age_hours: 120.0,
            retry_after_fail_hours: 3.0,
            email: String::new(),
            anisette_client_info:
                "<MacBookPro13,3> <Mac OS X;10.12.6;16G29> <com.apple.AuthKit/1 (com.apple.akd/1.0)>".into(),
            anisette_user_agent: "akd/1.0 CFNetwork/811.5.4 Darwin/16.7.0".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct State {
    last_success: u64,
    last_attempt: u64,
    last_fail_at: u64,
    last_error: String,
    fail_count: u32,
    /// 最初に入れ直せた端末（config.json の udid が空のとき、以後はこれだけを使う）
    udid: String,
    /// 通知の種類ごとの、最後に出した時刻（同じ知らせは 12 時間に1回まで）
    notices: HashMap<String, u64>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn fmt_time(t: u64) -> String {
    use chrono::{Local, TimeZone};
    if t == 0 {
        return "なし".into();
    }
    match Local.timestamp_opt(t as i64, 0) {
        chrono::LocalResult::Single(d) => d.format("%m/%d %H:%M").to_string(),
        _ => "?".into(),
    }
}

fn base_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn log(msg: &str) {
    let line = format!("{} {}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), msg);
    print!("{line}");
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(base_dir().join("resign.log"))
    {
        let _ = f.write_all(line.as_bytes());
    }
}

/// 無ければ既定の値。あるのに読めない・書き方が違うときは止める（黙って既定の値で動くと、書いた udid などが効かなくなる）
fn load<T: for<'de> Deserialize<'de> + Default>(p: &Path) -> Result<T, String> {
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    match fs::read_to_string(p) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(format!("{name} を読めない（{e}）")),
        Ok(s) => serde_json::from_str(s.trim_start_matches('\u{feff}'))
            .map_err(|e| format!("{name} の書き方が違う（{e}）。直すか、消して作り直してください")),
    }
}

fn save<T: Serialize>(p: &Path, v: &T) -> Result<(), String> {
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(v).unwrap())
        .and_then(|_| fs::rename(&tmp, p))
        .map_err(|e| format!("{} に書けない（{e}）", p.display()))
}

fn norm_udid(s: &str) -> String {
    s.chars().filter(|c| *c != '-' && !c.is_whitespace()).collect::<String>().to_uppercase()
}

/// 同じフォルダで2つ同時に動かないように（手で動かしたときとタスクが重なったとき）。40 分より古い印は、止まった回の残りとして無視する
struct RunLock(PathBuf);
impl RunLock {
    fn take(dir: &Path) -> Option<RunLock> {
        let p = dir.join("resign.lock");
        for _ in 0..2 {
            match fs::OpenOptions::new().write(true).create_new(true).open(&p) {
                Ok(_) => return Some(RunLock(p)),
                Err(_) => {
                    let old = fs::metadata(&p).and_then(|m| m.modified()).ok()
                        .and_then(|m| m.elapsed().ok()).map(|d| d.as_secs() > 40 * 60).unwrap_or(true);
                    if !old { return None; }
                    let _ = fs::remove_file(&p);
                }
            }
        }
        None
    }
}
impl Drop for RunLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Windows のトースト通知。同じ種類の知らせは 12 時間に1回まで。出せたときだけ「出した」と覚える
/// 文は環境変数で渡し、PowerShell の中で XML 用にくるむ（Apple から来たエラー文に引用符などが入っていても、命令として読まれないように）
fn notify(state: &mut State, key: &str, title: &str, body: &str) {
    log(&format!("通知: {title} / {body}"));
    if std::env::args().any(|a| a == "--check") {
        return;
    }
    let t = now();
    state.notices.retain(|_, at| t < *at + 7 * 24 * 3600);
    if state.notices.get(key).is_some_and(|at| t < *at + 12 * 3600) {
        return;
    }
    let script = "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;\
         [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;\
         $e = { param($s) [Security.SecurityElement]::Escape($s) };\
         $x = New-Object Windows.Data.Xml.Dom.XmlDocument;\
         $x.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text>' + (& $e $env:SA_TITLE) + '</text><text>' + (& $e $env:SA_BODY) + '</text></binding></visual></toast>');\
         $t = [Windows.UI.Notifications.ToastNotification]::new($x);\
         [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($t)";
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
    use base64::Engine;
    let enc = base64::engine::general_purpose::STANDARD.encode(utf16);
    use std::os::windows::process::CommandExt;
    let ok = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &enc])
        .env("SA_TITLE", title)
        .env("SA_BODY", body)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|st| st.success())
        .unwrap_or(false);
    if ok {
        state.notices.insert(key.into(), t);
    } else {
        log("通知を出せなかった（次の回でもう一度出す）");
    }
}

/// 資格情報マネージャーから「<Apple ID>.iloader」を探す（iloader の Save Credentials が置くもの。名前の後ろで絞るので、全部を並べてから選ぶ）
fn find_saved_emails() -> Result<Vec<String>, String> {
    use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, GetLastError};
    use windows_sys::Win32::Security::Credentials::{CREDENTIALW, CredEnumerateW, CredFree};
    let wide = |p: *const u16| -> String {
        if p.is_null() {
            return String::new();
        }
        unsafe {
            let mut n = 0;
            while *p.add(n) != 0 {
                n += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
        }
    };
    let mut count: u32 = 0;
    let mut creds: *mut *mut CREDENTIALW = std::ptr::null_mut();
    let mut out = vec![];
    unsafe {
        if CredEnumerateW(std::ptr::null(), 0, &mut count, &mut creds) == 0 {
            let e = GetLastError();
            return if e == ERROR_NOT_FOUND { Ok(out) } else { Err(format!("資格情報マネージャーを読めない（エラー {e}）")) };
        }
        for i in 0..count as usize {
            let c = &**creds.add(i);
            let target = wide(c.TargetName);
            let user = wide(c.UserName);
            if target.to_lowercase().ends_with(&format!(".{SERVICE}")) && user.contains('@') {
                out.push(user);
            }
        }
        CredFree(creds as *const _);
    }
    Ok(out)
}

struct Found {
    device: idevice::usbmuxd::UsbmuxdDevice,
    kind: &'static str,
}

async fn find_ipad(udid: &str) -> Result<Option<Found>, String> {
    let mut mux = UsbmuxdConnection::default()
        .await
        .map_err(|e| format!("Apple の端末管理（usbmuxd）につながらない: {e}"))?;
    let devs = mux
        .get_devices()
        .await
        .map_err(|e| format!("端末の一覧が取れない: {e}"))?;
    // udid（config.json か、最初に入れ直せた端末）が空なら、見えている端末が1台だけのときそれを使う（2台以上なら udid で選んでもらう）
    let udid = if udid.is_empty() {
        let mut ids: Vec<String> = devs.iter().map(|d| norm_udid(&d.udid)).collect();
        ids.sort();
        ids.dedup();
        match ids.len() {
            0 => return Ok(None),
            1 => ids.remove(0),
            n => return Err(format!("端末が {n} 台見えています。config.json の udid で、入れ直す iPad・iPhone を選んでください（{}）", ids.join(", "))),
        }
    } else {
        norm_udid(udid)
    };
    let mut best: Option<Found> = None;
    for d in devs {
        if norm_udid(&d.udid) != udid {
            continue;
        }
        let kind = match d.connection_type {
            Connection::Usb => "USB",
            Connection::Network(_) => "Wi-Fi",
            _ => "不明",
        };
        // USB があれば USB を優先（--wifi なら Wi-Fi だけを使う＝試験用）
        let want_wifi = std::env::args().any(|a| a == "--wifi");
        if want_wifi && kind != "Wi-Fi" {
            continue;
        }
        if best.is_none() || kind == "USB" {
            best = Some(Found { device: d, kind });
        }
    }
    Ok(best)
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let force = args.iter().any(|a| a == "--force");
    let check_only = args.iter().any(|a| a == "--check");
    let interactive = args.iter().any(|a| a == "--interactive");
    std::process::exit(run(force, check_only, interactive).await);
}

async fn run(force: bool, check_only: bool, interactive: bool) -> i32 {
    let dir = base_dir();
    let cfg_path = dir.join("config.json");
    let state_path = dir.join("state.json");
    let Some(_lock) = RunLock::take(&dir) else {
        log("ほかの回が動いているので、やめた");
        return 0;
    };
    let mut state: State = match load(&state_path) {
        Ok(s) => s,
        Err(e) => {
            log(&format!("失敗: {e}"));
            notify(&mut State::default(), "state", "暗記の署名し直し", &e);
            return 6;
        }
    };
    let cfg: Config = match load(&cfg_path) {
        Ok(c) => c,
        Err(e) => {
            log(&format!("失敗: {e}"));
            notify(&mut state, "config", "暗記の署名し直し", &e);
            let _ = save(&state_path, &state);
            return 6;
        }
    };
    if !cfg_path.exists() {
        let _ = save(&cfg_path, &cfg);
    }
    // state.json に書けないと、成功しても覚えられず、タスクのたびに入れ直してしまう。先に確かめる（--check では書かずに試す）
    let writable = if check_only {
        let p = dir.join("state.json.tmp");
        let r = fs::write(&p, b"{}").map_err(|e| format!("{} に書けない（{e}）", dir.display()));
        let _ = fs::remove_file(&p);
        r
    } else {
        save(&state_path, &state)
    };
    if let Err(e) = writable {
        log(&format!("失敗: {e}"));
        notify(&mut state, "write", "暗記の署名し直し", &format!("{e}。exe を書き込めるフォルダに置いてください"));
        return 7;
    }
    // ここから先の「覚える」（--check では書かない）
    let persist = |st: &State| {
        if !check_only {
            if let Err(e) = save(&state_path, st) {
                log(&format!("覚えられなかった: {e}"));
            }
        }
    };
    let t = now();

    let age_h = if state.last_success == 0 {
        f64::INFINITY
    } else {
        (t.saturating_sub(state.last_success)) as f64 / 3600.0
    };
    let expires = state.last_success + 7 * 24 * 3600;
    let expires_s = if state.last_success == 0 { "不明（まだ一度も入れ直していない）".to_string() } else { fmt_time(expires) };

    if !force && !check_only {
        if age_h < cfg.min_age_hours {
            // まだ早い（毎回は書かない）
            return 0;
        }
        // 続けて失敗したら、待つ時間を倍にしていく（3・6・12・24 時間。Apple へのログインを繰り返さないように）
        if state.fail_count > 0 {
            let wait_h = (cfg.retry_after_fail_hours * 2f64.powi(state.fail_count.min(8) as i32 - 1)).min(24.0);
            if t < state.last_fail_at.max(state.last_attempt) + (wait_h * 3600.0) as u64 {
                return 0;
            }
        }
    }

    // 0. IPA（端末やパスワードより先に。置き忘れに --check で気づけるように）
    let ipa = {
        let p = PathBuf::from(&cfg.ipa);
        if p.is_absolute() { p } else { dir.join(p) }
    };
    if !ipa.exists() {
        let msg = format!("IPA（{}）が exe と同じフォルダにありません", ipa.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
        log(&format!("失敗: {msg}"));
        notify(&mut state, "noipa", "暗記の署名し直し", &msg);
        persist(&state);
        return 5;
    }

    // 1. 端末が見えるか
    let udid = if !cfg.udid.is_empty() { cfg.udid.clone() } else { state.udid.clone() };
    let found = match find_ipad(&udid).await {
        Ok(f) => f,
        Err(e) => {
            log(&format!("失敗: {e}"));
            notify(&mut state, "usbmuxd", "暗記の署名し直し", &e);
            persist(&state);
            return 2;
        }
    };
    let Some(found) = found else {
        log(&format!(
            "{}が見えない（USB でも Wi-Fi でも）。前回の成功 {}・期限 {}",
            if udid.is_empty() { "端末" } else { "入れ直す端末" },
            fmt_time(state.last_success),
            expires_s
        ));
        if state.last_success > 0 && t + 30 * 3600 > expires {
            let (title, body) = if t >= expires {
                ("暗記の署名が切れています", format!("{} に切れました。iPad・iPhone をこのパソコンと同じ Wi-Fi か USB につなぐと、次の回で入れ直します", fmt_time(expires)))
            } else {
                ("暗記の署名がもうすぐ切れます", format!("{} に切れます。iPad・iPhone をこのパソコンと同じ Wi-Fi につなぐか、USB でつないでおいてください", fmt_time(expires)))
            };
            notify(&mut state, "noipad", title, &body);
        }
        persist(&state);
        return 2;
    };

    // 2. Apple ID とパスワード
    let email = if !cfg.email.is_empty() {
        cfg.email.to_lowercase()
    } else {
        let mut v = match find_saved_emails() {
            Ok(v) => v,
            Err(e) => {
                log(&format!("失敗: {e}"));
                notify(&mut state, "nocred", "暗記の署名し直し", &e);
                persist(&state);
                return 3;
            }
        };
        v.iter_mut().for_each(|e| *e = e.to_lowercase());
        v.sort();
        v.dedup();
        if v.len() != 1 {
            let msg = if v.is_empty() {
                "パスワードが保存されていません。iloader で「Save Credentials」にチェックを入れてログインし直してください".to_string()
            } else {
                format!("保存された Apple ID が {} 個あります。config.json の email で選んでください", v.len())
            };
            log(&format!("失敗: {msg}"));
            notify(&mut state, "nocred", "暗記の署名し直し", &msg);
            persist(&state);
            return 3;
        }
        v.remove(0)
    };
    let password = match keyring::Entry::new(SERVICE, &email).and_then(|e| e.get_password()) {
        Ok(p) => p,
        Err(_) => {
            let msg = "パスワードが保存されていません。iloader で「Save Credentials」にチェックを入れてログインし直してください";
            log(&format!("失敗: {msg}"));
            notify(&mut state, "nocred", "暗記の署名し直し", msg);
            persist(&state);
            return 3;
        }
    };

    if check_only {
        log(&format!(
            "確認: 端末は {} で見えている・パスワードと IPA はある・前回の成功 {}・期限 {}{}",
            found.kind,
            fmt_time(state.last_success),
            if state.last_success == 0 { "まだ分からない（--force で一度入れ直すと決まる）".to_string() } else { fmt_time(expires) },
            if udid.is_empty() { "・入れ直す端末はまだ決めていない（最初に入れ直せた端末に決める）" } else { "" }
        ));
        return 0;
    }

    log(&format!(
        "入れ直しを始める（端末は {}・前回の成功 {}{}）",
        found.kind,
        fmt_time(state.last_success),
        if force { "・--force" } else { "" }
    ));
    state.last_attempt = t;
    persist(&state);

    let _ = rustls::crypto::ring::default_provider().install_default();
    let _ = isideload::init();
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_ansi(false)
        .with_timer(tracing_subscriber::fmt::time::ChronoLocal::new("%Y-%m-%d %H:%M:%S".into()))
        .with_writer(LogWriter)
        .try_init();

    // 3. ログイン（iloader 2.4.2 と同じ設定・同じ保存先）
    let tfa = move |params: TwoFactorCallbackParams| async move {
        if !interactive {
            return Err(rootcause::report!("確認コード（2FA）を求められた"));
        }
        if params.unknown {
            println!("直前の確認方法がうまくいきませんでした。d で端末に送り直せます。");
        }
        println!("確認コードを入れてください（d＝端末に送る、r＝送り直す）:");
        let mut code = String::new();
        std::io::stdin().read_line(&mut code).ok();
        let code = code.trim().to_string();
        Ok(match code.as_str() {
            "d" => TwoFactorCallbackResponse::SendToDevices,
            "r" => TwoFactorCallbackResponse::ResendCode,
            _ => TwoFactorCallbackResponse::SubmitCode(code),
        })
    };

    let result: Result<(), String> = async {
        let provider = RemoteV3AnisetteProvider::default()
            .map_err(|e| format!("anisette の準備: {e}"))?
            .set_serial_number("0".to_string())
            .set_storage(Box::new(KeyringStorage::new(SERVICE.to_string())))
            .set_client_info_override(Some(AnisetteClientInfo {
                client_info: cfg.anisette_client_info.clone(),
                user_agent: cfg.anisette_user_agent.clone(),
            }))
            .set_url(&cfg.anisette_url);
        let mut account = AppleAccount::builder(&email)
            .anisette_provider(provider)
            .login(&password, tfa)
            .await
            .map_err(|e| format!("ログイン: {e}"))?;
        let dev_session = DeveloperSession::from_account(&mut account)
            .await
            .map_err(|e| format!("開発者セッション: {e}"))?;

        let mut sideloader = SideloaderBuilder::<MaxCertsCallbackBox, ExtensionsBehaviorCallbackBox>::new(
            dev_session,
            email.clone(),
        )
        .machine_name("iloader".into())
        .storage(Box::new(KeyringStorage::new(SERVICE.to_string())))
        .extensions_behavior(ExtensionsBehaviorSelection::Fixed(ExtensionsBehavior::ReuseMain))
        .max_certs_behavior(MaxCertsBehavior::Error)
        .build();

        let addr = UsbmuxdAddr::from_env_var().map_err(|e| format!("usbmuxd の宛先: {e}"))?;
        let dev_provider = found.device.to_provider(addr, "selfanki_resign");
        sideloader
            .install_app(
                &dev_provider,
                ipa.clone(),
                true,
                None::<fn(f32) -> std::future::Ready<()>>,
                None,
            )
            .await
            .map_err(|e| format!("署名・インストール: {e}"))?;
        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            state.last_success = now();
            state.fail_count = 0;
            state.last_error.clear();
            if cfg.udid.is_empty() && state.udid.is_empty() {
                state.udid = norm_udid(&found.device.udid);
                log("この端末に決めた（以後はこの端末だけを入れ直す。替えるときは state.json の udid を消す）");
            }
            log(&format!(
                "成功: 入れ直した（{}）。次の期限 {}",
                found.kind,
                fmt_time(state.last_success + 7 * 24 * 3600)
            ));
            if let Err(e) = save(&state_path, &state) {
                log(&format!("失敗: 入れ直せたが覚えられなかった（{e}）"));
                notify(&mut state, "write", "暗記の署名し直し", &format!("入れ直せましたが、{e}"));
                return 7;
            }
            0
        }
        Err(e) => {
            let first = e.lines().next().unwrap_or("").to_string();
            log(&format!("失敗: {e}"));
            state.fail_count += 1;
            state.last_fail_at = now();
            state.last_error = first.clone();
            let body = if e.contains("2FA") {
                "確認コードを求められました。selfanki_resign.exe --force --interactive を開いて、コードを入れてください".to_string()
            } else {
                format!("{}（期限 {}）", first.chars().take(120).collect::<String>(), expires_s)
            };
            notify(&mut state, &format!("fail:{}", first.chars().take(40).collect::<String>()), "暗記の署名し直しに失敗", &body);
            persist(&state);
            4
        }
    }
}

/// isideload の記録（tracing）も resign.log と画面の両方へ
struct LogWriter;
impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogWriter {
    type Writer = LogSink;
    fn make_writer(&'a self) -> Self::Writer {
        LogSink
    }
}
struct LogSink;
impl std::io::Write for LogSink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let _ = std::io::stdout().write_all(buf);
        if let Ok(mut f) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(base_dir().join("resign.log"))
        {
            let _ = f.write_all(buf);
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
