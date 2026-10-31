# commons-compress and xz are reached only through the engine installer. Keep the tar and xz
# classes (commons-compress loads some helpers reflectively) and silence optional dependencies
# (brotli, zstd, asm, osgi) that Android does not have.
-keep class org.apache.commons.compress.archivers.tar.** { *; }
-keep class org.tukaani.xz.** { *; }
-dontwarn org.apache.commons.compress.**
-dontwarn org.tukaani.xz.**
-dontwarn org.brotli.**
-dontwarn com.github.luben.zstd.**
-dontwarn org.objectweb.asm.**
-dontwarn org.osgi.**
-dontwarn java.nio.file.**

-keep class run.openbot.engine.EngineService { *; }
