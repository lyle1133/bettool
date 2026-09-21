[app]
title = 押注自动统计
package.name = bettool
package.domain = org.lyle
source.dir = .
source.include_exts = py,png,jpg,kv,atlas
version = 5.8.1
requirements = python3,kivy==2.3.1,pyjnius,android
orientation = portrait
fullscreen = 0
android.permissions = READ_EXTERNAL_STORAGE,WRITE_EXTERNAL_STORAGE
android.api = 33
android.minapi = 21
android.archs = arm64-v8a
android.allow_backup = True
p4a.bootstrap = sdl2

[buildozer]
log_level = 2
warn_on_root = 0
