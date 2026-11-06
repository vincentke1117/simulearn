// 知帆拓展启动程序（bin/<id>.exe）的 C 源码：PackageCompiler 2.4.0 的 src/embedding_wrapper.c 改一处。
// 原作者与许可见同目录 LICENSE.PackageCompiler.md（MIT），发布包的 LICENSES/index.html 也列了它。
//
// 改动：Windows 上设置 JULIA_DEPOT_PATH / JULIA_LOAD_PATH 时改用宽字符。
// 原版用 uv_exepath 拿到 UTF-8 的程序路径，再用窄字符的 _putenv_s 写进环境变量；Windows 按系统代码页
// （中文系统默认 GBK / 936）去解这串字节，路径里只要有中文就成了乱码，Julia 找不到程序自带的
// share/julia/artifacts，JLL 初始化直接报错退出。知帆把拓展装在 %LOCALAPPDATA%\Zhifan\extensions\…，
// 学生的 Windows 用户名是中文时就会撞上（2026-11-03 在系统代码页 936 的 labpc 上实测；开发机开着
// 「使用 Unicode UTF-8」，代码页是 65001，所以一直没测出来）。这里用 GetModuleFileNameW 取程序路径，
// 去掉末尾两级（bin\<id>.exe）得到根目录，再用 _wgetenv / _wputenv_s 读写，全程不经过系统代码页。
// 其余（非 Windows 的分支、参数转换、初始化、调用入口）与原版相同。

// Standard headers
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Julia headers
#include "julia.h"
#include "uv.h"

#ifdef _WIN32
#include <windows.h>
#include <wchar.h>
#endif

#ifdef _MSC_VER
JL_DLLEXPORT char *dirname(char *);
#else
#include <libgen.h>
#endif

#ifdef NEW_DEFINE_FAST_TLS_SYNTAX
JULIA_DEFINE_FAST_TLS
#else
JULIA_DEFINE_FAST_TLS()
#endif

jl_value_t *checked_eval_string(const char *code) {
    jl_value_t *result = jl_eval_string(code);
    if (jl_exception_occurred()) {
        // none of these allocate, so a gc-root (JL_GC_PUSH) is not necessary
        jl_call2(jl_get_function(jl_base_module, "showerror"), jl_stderr_obj(),
                 jl_exception_occurred());
        jl_printf(jl_stderr_stream(), "\n");
        jl_atexit_hook(1);
        exit(1);
    }
    assert(result && "Missing return value but no exception occurred!");
    return result;
}

#ifdef _WIN32
// 在环境变量 name 的现有值后面接上 ";" + dir（与原版一致：外面已经设了的排在前面）
static int append_env_path_w(const wchar_t *name, const wchar_t *dir) {
    const wchar_t *curr = _wgetenv(name);
    size_t curr_len = (curr == NULL) ? 0 : wcslen(curr);
    wchar_t *value = (wchar_t *)calloc(curr_len + 1 + wcslen(dir) + 1, sizeof(wchar_t));
    if (!value) return 1;
    if (curr_len > 0) {
        wcscat(value, curr);
        wcscat(value, L";");
    }
    wcscat(value, dir);
    int err = _wputenv_s(name, value);
    free(value);
    return err;
}

// <根目录>\share\julia 进 DEPOT_PATH 和 LOAD_PATH；根目录 = 程序路径去掉 \bin\<id>.exe
static int set_depot_load_path_w(void) {
    DWORD cap = 32768;  // Windows 长路径的上限
    wchar_t *exe = (wchar_t *)calloc(cap, sizeof(wchar_t));
    if (!exe) return 1;
    DWORD len = GetModuleFileNameW(NULL, exe, cap);
    if (len == 0 || len >= cap) {
        free(exe);
        return 1;
    }
    for (int level = 0; level < 2; level++) {
        wchar_t *sep = wcsrchr(exe, L'\\');
        if (!sep) {
            free(exe);
            return 1;
        }
        *sep = L'\0';
    }
    const wchar_t *share = L"\\share\\julia";
    wchar_t *share_dir = (wchar_t *)calloc(wcslen(exe) + wcslen(share) + 1, sizeof(wchar_t));
    if (!share_dir) {
        free(exe);
        return 1;
    }
    wcscat(share_dir, exe);
    wcscat(share_dir, share);
    int err = append_env_path_w(L"JULIA_DEPOT_PATH", share_dir) || append_env_path_w(L"JULIA_LOAD_PATH", share_dir);
    free(share_dir);
    free(exe);
    return err;
}
#else
void set_depot_load_path(const char *root_dir) {
    char *path_sep = ":";
    char *julia_share_subdir = "/share/julia";
    int share_path_len = strlen(root_dir) + strlen(julia_share_subdir) + 1;

    char *curr_depot_path = getenv("JULIA_DEPOT_PATH");
    int curr_depot_path_len = curr_depot_path == NULL ? 0 : strlen(curr_depot_path);
    int new_depot_path_len = curr_depot_path_len + 1 + share_path_len;
    char *new_depot_path = calloc(sizeof (char), new_depot_path_len);
    if (curr_depot_path_len > 0) {
        strcat(new_depot_path, curr_depot_path);
        strcat(new_depot_path, path_sep);
    }
    strcat(new_depot_path, root_dir);
    strcat(new_depot_path, julia_share_subdir);

    char *curr_load_path = getenv("JULIA_LOAD_PATH");
    int curr_load_path_len = curr_load_path == NULL ? 0 : strlen(curr_load_path);
    int new_load_path_len = curr_load_path_len + 1 + share_path_len;
    char *new_load_path = calloc(sizeof (char), new_load_path_len);
    if (curr_load_path_len > 0) {
        strcat(new_load_path, curr_load_path);
        strcat(new_load_path, path_sep);
    }
    strcat(new_load_path, root_dir);
    strcat(new_load_path, julia_share_subdir);

    setenv("JULIA_DEPOT_PATH", new_depot_path, 1);
    setenv("JULIA_LOAD_PATH", new_load_path, 1);
    free(new_load_path);
    free(new_depot_path);
}
#endif

// main function (windows UTF16 -> UTF8 argument conversion code copied from
// julia's ui/repl.c)
#ifdef _WIN32
int wmain(int argc, wchar_t *wargv[], wchar_t *envp[]) {
    char **argv = (char **)malloc(sizeof(char *) * argc);
    if (!argv) return 1;

    for (int i = 0; i < argc; i++) { // write the command line to UTF8
        wchar_t *warg = wargv[i];
        size_t len = WideCharToMultiByte(CP_UTF8, 0, warg, -1, NULL, 0, NULL, NULL);
        if (!len) return 1;
        char *arg = (char *)malloc(len);
        if (!WideCharToMultiByte(CP_UTF8, 0, warg, -1, arg, len, NULL, NULL)) return 1;
        argv[i] = arg;
    }
#else
int main(int argc, char *argv[]) {
    argv = uv_setup_args(argc, argv);
#endif

    // Find where eventual julia arguments start
    int program_argc = argc;
    for (int i = 0; i < argc; i++) {
        if (strcmp(argv[i], "--julia-args") == 0) {
            program_argc = i;
            break;
        }
    }
    int julia_argc = argc - program_argc;
    if (julia_argc > 0) {
        // Replace `--julia-args` with the program name
        argv[program_argc] = argv[0];
        char **julia_argv = &argv[program_argc];
        jl_parse_opts(&julia_argc, &julia_argv);
    }

    // Set up LOAD_PATH and DEPOT_PATH
#ifdef _WIN32
    if (set_depot_load_path_w()) {
        fprintf(stderr, "fatal error: failed to set JULIA_DEPOT_PATH from the program path\n");
        return 1;
    }
#else
    // Get the current exe path so we can compute a relative depot path
    char *exe_path = (char *)malloc(PATH_MAX);
    size_t path_size = PATH_MAX;
    if (!exe_path) {
        jl_errorf("fatal error: failed to allocate memory: %s",
                  strerror(errno));
        free(exe_path);
        return 1;
    }
    if (uv_exepath(exe_path, &path_size)) {
        jl_error("fatal error: unexpected error while retrieving exepath");
        free(exe_path);
        return 1;
    }
    char *root_dir = dirname(dirname(exe_path));
    set_depot_load_path(root_dir);
#endif

    jl_init();

    // Initialize Core.ARGS with the full argv.
    jl_set_ARGS(program_argc, argv);

    // Update ARGS and PROGRAM_FILE
    checked_eval_string("append!(empty!(Base.ARGS), Core.ARGS)");

#if JULIA_VERSION_MAJOR == 1 && JULIA_VERSION_MINOR >= 12
    checked_eval_string("Core.eval(Base, :(global PROGRAM_FILE))");
    checked_eval_string("Base.PROGRAM_FILE = popfirst!(ARGS)");
#else
    jl_value_t *firstarg = checked_eval_string("popfirst!(ARGS)");
    JL_GC_PUSH1(&firstarg);
    jl_sym_t *var = jl_symbol("PROGRAM_FILE");
    #if JULIA_VERSION_MAJOR == 1 && JULIA_VERSION_MINOR >= 11
        jl_binding_t *bp = jl_get_binding_wr(jl_base_module, var, /* alloc */ 1);
        jl_checked_assignment(bp, jl_base_module, var, firstarg);
    #elif JULIA_VERSION_MAJOR == 1 && JULIA_VERSION_MINOR >= 10
        jl_binding_t *bp = jl_get_binding_wr(jl_base_module, var);
        jl_checked_assignment(bp, jl_base_module, var, firstarg);
    #elif JULIA_VERSION_MAJOR == 1 && JULIA_VERSION_MINOR >= 9
        jl_binding_t *bp = jl_get_binding_wr(jl_base_module, var, 1);
        jl_checked_assignment(bp, firstarg);
    #else
        jl_set_global(jl_base_module, jl_symbol("PROGRAM_FILE"), firstarg);
    #endif
    JL_GC_POP();
#endif

    // call the work function, and get back a value
    jl_value_t *jl_retcode = checked_eval_string(JULIA_MAIN "()");
    int32_t retcode = 0;
    if (!jl_typeis(jl_retcode, jl_int32_type)) {
        fprintf(stderr,
                "ERROR: expected a Cint return value from function " JULIA_MAIN
                "\n");
        retcode = 1;
    } else {
        retcode = jl_unbox_int32(jl_retcode);
    }

    // Cleanup and gracefully exit
#ifndef _WIN32
    free(exe_path);
#endif
    jl_atexit_hook(retcode);
    return retcode;
}
