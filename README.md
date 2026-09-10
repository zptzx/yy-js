# yy-js
在 Quantumult X 的[rewrite_local]中添加以下代码片段：
[rewrite_local]
^https?://cgm\.yuwell\.com/cgmapi/Account/(LoginWithJpushToken|RefreshToken) url script-request-header https://raw.githubusercontent.com/zptzx/yy-js/main/yuwell_token.js
^https?://cgm\.yuwell\.com/cgmapi/Account/GetLastSingleDeviceID url script-request-header https://raw.githubusercontent.com/zptzx/yy-js/main/yuwell_body_req.js
^https?://cgm\.yuwell\.com/cgmapi/Account/GetLastSingleDeviceID url script-response-body https://raw.githubusercontent.com/zptzx/yy-js/main/yuwell_body_resp.js
^https?://cgm\.yuwell\.com/cgmapi/DataSync/DownloadData url script-request-body https://raw.githubusercontent.com/zptzx/yy-js/main/yuwell_body_req.js
然后在 [task_local]下面添加下面的代码片段
[task_local]
*/30 * * * * https://raw.githubusercontent.com/zptzx/yy-js/main/sync_yuwell_token.js, tag=yyToken同步, enabled=true


最后 配置青龙面板信息
在 Quantumult X 中：

点击底部“构造请求”按钮或点击右下角“风车”按钮进入设置页面，打开“HTTP请求”
点击“右下角按钮” → “编辑器”
在编辑器中输入以下代码并执行：
// Quantumult X
$prefs.setValueForKey('http://192.168.1.100:5700', 'ql_url');
$prefs.setValueForKey('abc123', 'ql_client_id');
$prefs.setValueForKey('xyz789', 'ql_client_secret');

$done()


参数说明：

ql_url: 青龙面板地址（如：http://192.168.1.100:5700或https://ql.example.com）
ql_client_id: 青龙应用的客户端ID
ql_client_secret: 青龙应用的客户端密钥

登录青龙面板
进入“系统设置” → “应用设置”
点击“新建应用”
输入应用名称（如：Surge），选择权限（需要环境变量权限）
保存后获得Client ID和Client Secret
