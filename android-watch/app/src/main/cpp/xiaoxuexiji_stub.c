/*
 * Tiny no-op native library so the APK carries lib/armeabi-v7a.
 * ColorOS Watch installers behave badly with pure-Java APKs.
 */
#include <jni.h>

JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *reserved) {
    (void) vm;
    (void) reserved;
    return JNI_VERSION_1_6;
}

JNIEXPORT jint JNICALL
xiaoxuexiji_stub_version(void) {
    return 1;
}
