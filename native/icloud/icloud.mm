// iCloud container access for the Electron main process (Electron has no API for it).
// N-API only, so one build works in any Node/Electron version.
#import <Foundation/Foundation.h>
#include <node_api.h>
#include <string>

namespace {

struct Work {
  napi_async_work work;
  napi_deferred deferred;
  std::string identifier;
  std::string path;
};

// Off the main thread: Apple says the lookup can block while the container is set up.
void Execute(napi_env, void* data) {
  auto* w = static_cast<Work*>(data);
  @autoreleasepool {
    NSString* ident = [NSString stringWithUTF8String:w->identifier.c_str()];
    NSURL* url = [[NSFileManager defaultManager] URLForUbiquityContainerIdentifier:ident];
    if (url) w->path = url.path.UTF8String;
  }
}

void Complete(napi_env env, napi_status, void* data) {
  auto* w = static_cast<Work*>(data);
  napi_value result;
  if (w->path.empty()) napi_get_null(env, &result);
  else napi_create_string_utf8(env, w->path.c_str(), w->path.size(), &result);
  napi_resolve_deferred(env, w->deferred, result);
  napi_delete_async_work(env, w->work);
  delete w;
}

// containerPath(identifier): Promise<string | null> — null when iCloud Drive is off or the
// app isn't entitled to the container.
napi_value ContainerPath(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  size_t len = 0;
  if (argc < 1 || napi_get_value_string_utf8(env, argv[0], nullptr, 0, &len) != napi_ok) {
    napi_throw_type_error(env, nullptr, "containerPath(identifier: string)");
    return nullptr;
  }
  auto* w = new Work();
  w->identifier.resize(len);
  napi_get_value_string_utf8(env, argv[0], w->identifier.data(), len + 1, &len);

  napi_value promise, name;
  napi_create_promise(env, &w->deferred, &promise);
  napi_create_string_utf8(env, "icloudContainerPath", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, Execute, Complete, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "containerPath", NAPI_AUTO_LENGTH, ContainerPath, nullptr, &fn);
  napi_set_named_property(env, exports, "containerPath", fn);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
