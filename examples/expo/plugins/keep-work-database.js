// Expo config plugin: keeps the constructor of WorkManager's database class
// when R8 shrinks a release build.
//
// expo-background-task runs on WorkManager. Expo's Android template turns R8
// on for release builds, and in this example's release build R8 removed the
// no-argument constructor of androidx.work.impl.WorkDatabase_Impl, which Room
// creates by reflection: the app crashed at launch with
// NoSuchMethodException: WorkDatabase_Impl.<init>. The Android emulator job
// in CI found it. If your app uses expo-background-task with R8, check a
// release build, and copy this plugin if it crashes the same way.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const MARK = "# holdsend-example: keep Room database constructors";
const RULES = `${MARK}\n-keep class * extends androidx.room.RoomDatabase { <init>(); }\n-keep class androidx.work.impl.WorkDatabase_Impl { <init>(); }\n`;

module.exports = function keepWorkDatabase(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!current.includes(MARK)) fs.writeFileSync(file, `${current.trimEnd()}\n\n${RULES}`);
      return cfg;
    },
  ]);
};
