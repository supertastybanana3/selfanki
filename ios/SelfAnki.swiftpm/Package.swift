// swift-tools-version: 5.9

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "SelfAnki",
    platforms: [
        .iOS("17.5")
    ],
    products: [
        .iOSApplication(
            name: "SelfAnki",
            targets: ["AppModule"],
            bundleIdentifier: "local.selfanki.app",
            displayVersion: "0.7",
            bundleVersion: "7",
            appIcon: .asset("AppIcon"),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ]
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: "."
        )
    ]
)
