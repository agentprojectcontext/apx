// iOS 27 refuses to launch an app without the UIScene life cycle, and the SDK 57 template still starts
// React Native from the app delegate. This adopts Expo's own ExpoAppSceneDelegate at prebuild.
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const WINDOW_START = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

module.exports = function withIosScenes(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "EXExpoAppSceneDelegate" },
        ],
      },
    };
    return cfg;
  });
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") throw new Error("with-ios-scenes: expected a Swift AppDelegate");
    let code = cfg.modResults.contents;
    if (!code.includes("ExpoReactNativeFactoryProvider")) {
      const declaration = "class AppDelegate: ExpoAppDelegate {";
      if (!code.includes(declaration)) throw new Error("with-ios-scenes: AppDelegate declaration not found");
      code = code.replace(declaration, "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {");
      // The scene delegate creates the window and starts React Native into it.
      if (!WINDOW_START.test(code)) throw new Error("with-ios-scenes: window start-up block not found");
      code = code.replace(WINDOW_START, "\n");
    }
    cfg.modResults.contents = code;
    return cfg;
  });
};
