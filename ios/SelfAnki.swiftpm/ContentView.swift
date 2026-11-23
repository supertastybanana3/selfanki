import SwiftUI
import UIKit
import WebKit
import GameController
import AVFoundation

// カードの音声と読み上げを殻で鳴らす。「ほかの音と混ぜる」（.mixWithOthers）なので、裏で流している音楽などを止めずに上に重なる
// （WKWebView の中で鳴らすと WebKit がほかのアプリの再生を止めてしまう）。ページから {audio: play|speak|stop|pause|seek} が届く
final class AudioBridge: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    weak var webView: WKWebView?
    private var player: AVAudioPlayer?
    private let synth = AVSpeechSynthesizer()
    private var token = 0
    override init() { super.init(); synth.delegate = self }
    private func session() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? s.setActive(true)
    }
    func handle(_ d: [String: Any]) {
        switch d["audio"] as? String {
        case "play":
            stop(); session(); token = d["id"] as? Int ?? 0
            guard let b = d["data"] as? String, let data = Data(base64Encoded: b), let p = try? AVAudioPlayer(data: data) else { finished(); return }
            p.delegate = self; player = p; p.play()
        case "speak":
            stop(); session(); token = d["id"] as? Int ?? 0
            let u = AVSpeechUtterance(string: d["text"] as? String ?? "")
            let lang = d["lang"] as? String ?? "ja-JP"
            // {{tts … voices=… speed=…}}: 書いた順に端末にある声を選び（「Apple_Kyoko」のように会社_名前でもよい）、速さは標準の何倍か
            let want = (d["voices"] as? [String] ?? []).map { $0.lowercased() }
            let all = AVSpeechSynthesisVoice.speechVoices()
            u.voice = want.lazy.compactMap { w in all.first { $0.name.lowercased() == w || $0.name.lowercased() == (w.split(separator: "_").last.map(String.init) ?? w) } }.first
                ?? AVSpeechSynthesisVoice(language: lang)
            let rate = (d["rate"] as? Double) ?? 1
            u.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * Float(rate)))
            synth.speak(u)
        case "stop": stop()
        case "pause":
            if let p = player { if p.isPlaying { p.pause() } else { p.play() } }
            else if synth.isSpeaking { if synth.isPaused { synth.continueSpeaking() } else { synth.pauseSpeaking(at: .immediate) } }
        case "seek":
            if let p = player { p.currentTime = max(0, min(p.duration, p.currentTime + (d["d"] as? Double ?? 0))) }
        default: break
        }
    }
    private func stop() {
        player?.stop(); player = nil
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
    }
    private func finished() {
        let id = token
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript("window.onNative && window.onNative('audioEnded', \(id))", completionHandler: nil) }
    }
    func audioPlayerDidFinishPlaying(_ p: AVAudioPlayer, successfully flag: Bool) { if p === player { finished() } }
    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { finished() }
}

// 自作の暗記アプリの殻：中身（Web）を全画面で開き、Apple Pencil Pro のスクイーズとダブルタップを中身へ渡すだけ
// 中身は自分の Cloudflare Pages（Config.swift の appHost・合言葉つき）。中身を直したら開き直すだけで最新になる
// ネットが無いときは中身の Service Worker が端末の控えを出す（WKAppBoundDomains に入れたドメインだけ Service Worker が動く）
let appHost = SelfAnkiConfig.host
let defaultURL = "https://\(SelfAnkiConfig.host)/app/"
/// 殻が自分で出す文言（確認の「キャンセル」・開けなかったときの画面）の言語。端末の言語が日本語なら日本語、ほかは英語
let uiJapanese = Locale.preferredLanguages.first?.lowercased().hasPrefix("ja") ?? false

struct ContentView: View {
    @State private var ready = false
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if ready { WebShell().ignoresSafeArea() }
            else { ProgressView().tint(.white) }
        }
        // 起動と同時に WebView を作ると画面が出ないことがあった（試作 v1）ので、最初の描画のあとで作る
        .task { try? await Task.sleep(nanoseconds: 300_000_000); ready = true }
    }
}

// ハードウェアキーボードのキーを、iPad の日本語入力より先に受け取る（UIKeyCommand・システムより優先）。
// 日本語入力のままだと、ページで止めても数字やスペースが変換に回り、以後のキーが全部吸われてしまう。
// 文字を打つ欄にいる間（ページが typing を知らせる）は何も取らない＝ふつうに入力できる
final class KeyWebView: WKWebView {
    var typing = false
    var onKey: ((String, UIKeyModifierFlags) -> Void)?
    private lazy var commands: [UIKeyCommand] = {
        var list: [(String, UIKeyModifierFlags)] = []
        for k in [" ", "\r", "1", "2", "3", "4", "5", "6", "7", "u", "z", "r", "m", "i", "-", "=", "@", "*", UIKeyCommand.inputEscape] { list.append((k, [])) }
        for k in ["1", "2", "3", "4", "5", "6", "7"] { list.append((k, .control)) }
        list += [("z", .command), ("z", .control), ("i", [.control, .alternate]), ("1", .shift), (":", .shift), ("-", .shift), ("8", .shift)]
        list.append((UIKeyCommand.f5, []))
        return list.map { k, m in
            let c = UIKeyCommand(input: k, modifierFlags: m, action: #selector(handleKey(_:)))
            c.wantsPriorityOverSystemBehavior = true
            return c
        }
    }()
    override var keyCommands: [UIKeyCommand]? { typing ? super.keyCommands : (super.keyCommands ?? []) + commands }
    @objc func handleKey(_ c: UIKeyCommand) {
        var k = c.input ?? ""
        let m = c.modifierFlags
        if m.contains(.shift) { k = ["1": "!", ":": "*", "-": "=", "8": "*"][k] ?? k }   // 記号は日本語配列（! ＝ Shift+1・* ＝ Shift+:・= ＝ Shift+-）と英語配列（* ＝ Shift+8）
        if k == "\r" { k = "Enter" } else if k == UIKeyCommand.inputEscape { k = "Escape" } else if k == UIKeyCommand.f5 { k = "F5" }
        onKey?(k, m)
    }
}

struct WebShell: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []   // 音声の自動再生
        cfg.websiteDataStore = .default()                    // 端末に残す保存（IndexedDB・localStorage・Service Worker）
        cfg.limitsNavigationsToAppBoundDomains = true        // これが無いと WKWebView では Service Worker が動かない
        cfg.userContentController.add(context.coordinator, name: "sa")   // ページ → 殻（文字を打つ欄に入った・出た）
        let wv = KeyWebView(frame: .zero, configuration: cfg)
        wv.onKey = { [weak coord = context.coordinator] k, m in coord?.sendKey(k, m) }
        wv.isOpaque = false
        wv.backgroundColor = .black
        wv.scrollView.backgroundColor = .black
        wv.scrollView.contentInsetAdjustmentBehavior = .never  // 画面の端は中身の env(safe-area-inset-*) で調整
        wv.scrollView.bounces = false
        wv.navigationDelegate = context.coordinator
        wv.uiDelegate = context.coordinator   // 中身の alert / confirm を iPad の小窓で出す（無いと何も出ない）
        let pi = UIPencilInteraction()
        pi.delegate = context.coordinator
        wv.addInteraction(pi)
        context.coordinator.webView = wv
        context.coordinator.watchKeyboard()
        context.coordinator.load()
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, UIPencilInteractionDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let audio = AudioBridge()
        func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let d = message.body as? [String: Any] else { return }
            if let t = d["typing"] as? Bool { (webView as? KeyWebView)?.typing = t }
            if d["audio"] != nil { audio.webView = webView; audio.handle(d) }
        }
        func sendKey(_ k: String, _ m: UIKeyModifierFlags) {
            let js = "window.onNative && window.onNative('key', {key: \(jsString(k)), ctrl: \(m.contains(.control)), meta: \(m.contains(.command)), alt: \(m.contains(.alternate)), shift: \(m.contains(.shift))})"
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }
        private func jsString(_ s: String) -> String {
            let d = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
            return String(String(data: d, encoding: .utf8)!.dropFirst().dropLast())
        }
        weak var webView: WKWebView?

        // 合言葉を組み込んで作ったとき（非公開のリポジトリで組んだとき）だけ、合言葉のクッキーを置いてから開く。
        // 組み込んでいないとき（ふつう）は、サーバーが番号の入力画面（/pair）を出す。番号を入れるとクッキーが端末に残る
        func load() {
            let s = UserDefaults.standard.string(forKey: "url") ?? defaultURL
            guard let u = URL(string: s), let wv = webView else { return }
            if SelfAnkiSecret.token.isEmpty { wv.load(URLRequest(url: u)); return }
            let props: [HTTPCookiePropertyKey: Any] = [.domain: appHost, .path: "/", .name: "sa", .value: SelfAnkiSecret.token,
                                                        .secure: "TRUE", .expires: Date(timeIntervalSinceNow: 390 * 86400)]
            if let c = HTTPCookie(properties: props) {
                wv.configuration.websiteDataStore.httpCookieStore.setCookie(c) { wv.load(URLRequest(url: u)) }
            } else { wv.load(URLRequest(url: u)) }
        }
        private func send(_ kind: String) {
            webView?.evaluateJavaScript("window.onNative && window.onNative('\(kind)')", completionHandler: nil)
        }
        func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
            if squeeze.phase == .ended { send("squeeze") }
        }
        func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
            send("tap")
        }
        // ハードウェアキーボード（Bluetooth・Magic Keyboard など）のつなぎ／外しを中身へ知らせる（1＝つながっている）。
        // 中身はつながったらキーボードモードを ON にする（⌨ で手で切れる）
        private var observers: [NSObjectProtocol] = []
        func watchKeyboard() {
            let nc = NotificationCenter.default
            for name in [Notification.Name.GCKeyboardDidConnect, .GCKeyboardDidDisconnect, UIApplication.didBecomeActiveNotification] {
                observers.append(nc.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    Task { @MainActor in self?.sendKeyboard(); self?.takeKeys() }
                })
            }
        }
        func sendKeyboard() {
            let on = GCKeyboard.coalesced != nil
            webView?.evaluateJavaScript("window.onNative && window.onNative('kbd', \(on ? 1 : 0))", completionHandler: nil)
        }
        // ハードウェアキーボードのキーは、入力を受け取る相手（ファーストレスポンダ）にしか届かない。Safari と違って自作の殻では
        // 誰も指定しないので、キーがページに届かなかった（0.4 まで）。開いたとき・前面に戻ったとき・キーボードをつないだとき・小窓を閉じたときに受け取り役にする
        func takeKeys() {
            guard let wv = webView, wv.window != nil else { return }
            var ok = wv.isFirstResponder
            if !ok { ok = wv.becomeFirstResponder() }
            wv.evaluateJavaScript("window.onNative && window.onNative('fr', \(ok ? 1 : 0))", completionHandler: nil)   // 受け取り役になれたか（確かめる用）
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript("window.onNative && window.onNative('caps', {audio: true, keys: true})", completionHandler: nil)   // 殻が音声とキーを受け持てる
            sendKeyboard()
            takeKeys()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.takeKeys() }
        }
        private func topVC() -> UIViewController? {
            var vc = webView?.window?.rootViewController
            while let p = vc?.presentedViewController { vc = p }
            return vc
        }
        // window.open（「？」ボタン・カードのリンク・共有デッキ）は Safari などで開く（これが無いと WKWebView では何も起きない）
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let u = navigationAction.request.url, let s = u.scheme?.lowercased(), s == "https" || s == "http" || s == "mailto" { UIApplication.shared.open(u) }
            return nil
        }
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard let vc = topVC() else { completionHandler(); return }
            let ac = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            ac.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in completionHandler(); self?.takeKeys() })
            vc.present(ac, animated: true)
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let vc = topVC() else { completionHandler(false); return }
            let ac = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            ac.addAction(UIAlertAction(title: uiJapanese ? "キャンセル" : "Cancel", style: .cancel) { [weak self] _ in completionHandler(false); self?.takeKeys() })
            ac.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in completionHandler(true); self?.takeKeys() })
            vc.present(ac, animated: true)
        }
        // つながらないとき（ネットが切れている等）は、理由と「もう一度」を出す
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let msg = error.localizedDescription.replacingOccurrences(of: "<", with: "&lt;")
            webView.loadHTMLString("""
            <html><head><meta name=viewport content='width=device-width,initial-scale=1'></head>
            <body style='background:#000;color:#eee;font:17px -apple-system;padding:60px 24px'>
            <h2>\(uiJapanese ? "開けませんでした" : "Could not open")</h2><p>\(msg)</p><p>\(uiJapanese ? "最初の1回だけはネットが要ります（そのあとはオフラインでも開けます）。" : "The first launch needs the internet (after that it also opens offline).")</p>
            <p><a href='\(UserDefaults.standard.string(forKey: "url") ?? defaultURL)' style='color:#77ccff;font-size:20px'>\(uiJapanese ? "もう一度" : "Try again")</a></p></body></html>
            """, baseURL: nil)
        }
    }
}
