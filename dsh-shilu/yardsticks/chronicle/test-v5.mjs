// v5 单元回归：路径形状 + 归一 + 垃圾串不入档
import { pathToFileURL } from 'node:url';
const P = await import(pathToFileURL(process.argv[2] ?? 'C:/Users/<user>/.dsh/profiles/web/node_modules/dsh-chronicle/lib/projections.js').href);

let pass = 0, fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}\n      得到 ${g}\n      期望 ${w}`); }
}
function hit(label, text, want) { eq(label, P.pathsIn(text), want); }

console.log('【该认的】');
hit('盘符反斜杠', 'C:\\Users\\<user>', ['C:\\Users\\<user>']);
hit('盘符正斜杠', 'C:/Users/<user>', ['C:/Users/<user>']);
hit('中文目录名', 'F:\\AI\\N.E.K.O\\memory\\阿初', ['F:\\AI\\N.E.K.O\\memory\\阿初']);
hit('真 UNC', '\\\\server\\share\\a.txt', ['\\\\server\\share\\a.txt']);
hit('正斜杠 UNC', '//server/share/a.txt', ['//server/share/a.txt']);
hit('设备/超长路径 \\\\?\\', '\\\\?\\usb#vid_2d99&pid_a019', ['\\\\?\\usb#vid_2d99&pid_a019']);
hit('UNC 中文共享名', '\\\\server\\中文共享\\a.txt', ['\\\\server\\中文共享\\a.txt']);
hit('句末句号要剪掉', '见 C:\\Users\\<user>.', ['C:\\Users\\<user>']);

console.log('\n【不该认的（v4 的垃圾实体全在这）】');
hit('源码里的正则字面量 /\\\\/g', 'id.replace(/\\\\/g, "\\\\")', []);
hit('二次转写的 \\\\Users\\\\<user>', '含旧路径 C:\\\\Users\\\\<user> 的值', []);
hit('单个反斜杠碎片 \\\\Program', 'x \\\\Program Files', []);
hit('四个反斜杠', '"\\\\\\\\"', []);
hit('网址不能切成路径', 'https://api.kourichat.com/api/pricing/models', []);
hit('file:// 也不算路径', 'file://server/share/a.txt', []);
hit('协议半截 p://', 'p://api.x/y', []);
hit('裸斜杠 /g', 'split(/g)', []);
hit('转义换行 \\\\n', 'a\\\\nb', []);
hit('PowerShell 正则片段', 'Where-Object { $_.Name -notmatch "\\\\(node_modules|\\.git" }', []);
hit('路径拼接碎片', 'a \\\\.\\\\.\\\\CurrentVersion\\\\(Windows', []);
hit('两个点当 server', 'x \\\\.\\\\.\\\\', []);
hit('点起头的 server', 'a \\\\.\\\\.\\\\.\\\\CurrentVersion\\\\(Windows', []);
hit('非主机名字符起头', 'gci \\\\(node_modules|\\.git', []);

console.log('\n【归一】');
eq('大小写+斜杠+尾斜杠', P.pathKey('C:\\Users\\<user>'), P.pathKey('c:/Users/<user>/'));
eq('转写写法归一', P.pathKey('C:\\\\Users\\\\<user>'), P.pathKey('C:\\Users\\<user>'));
eq('UNC 与"从根"不许混', P.pathKey('\\\\server\\share') === P.pathKey('\\server\\share'), false);
eq('UNC 保留双反斜杠', P.pathKey('\\\\server\\share'), '\\\\server\\share');

console.log('\n【分级】');
eq('md 是文件', P.kindOfPath('F:\\AI\\DSH\\大肥鱼\\README.md'), 'file');
eq('n.e.k.o 是目录', P.kindOfPath('F:\\AI\\N.E.K.O'), 'dir');
eq('中文目录', P.kindOfPath('F:\\AI\\DSH\\大肥鱼'), 'dir');

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
