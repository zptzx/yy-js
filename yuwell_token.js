// yuwell_token.js - 鱼跃安耐糖 Token 抓取（精简版）
// 部署位置: Quantumult X Scripts 目录
//
// 职责：
//   - 从 LoginWithJpushToken / RefreshToken / AddAccessAppLog 的请求头抓 Token 和手机号
//   - 只写 token、jwtInfo、deviceInfo.PhoneNumber
//   - 不写其他 deviceInfo 字段（由 yuwell_body_req.js / yuwell_body_resp.js 负责）
//
// 注意：GetLastSingleDeviceID、DownloadData 的抓取已交给新脚本，本脚本不再处理

const cookieName = '鱼跃安耐糖';
const tokenKey = 'yuwell_token';

// 只保留这三个 URL
const urlPatterns = [
    /cgm\.yuwell\.com\/cgmapi\/Account\/LoginWithJpushToken/,
    /cgm\.yuwell\.com\/cgmapi\/Account\/RefreshToken/,
    /cgm\.yuwell\.com\/cgm_apptrackevent\/AppEventTracking\/AddAccessAppLog/
];

function handleRequest() {
    const url = $request.url;
    const headers = $request.headers || {};
    const body = $request.body;

    // 检查是否匹配
    let isTarget = false;
    for (let pattern of urlPatterns) {
        if (pattern.test(url)) {
            isTarget = true;
            break;
        }
    }
    if (!isTarget) return $done({});

    // ========== 从请求头拿 Token ==========
    const authHeader = headers['Authorization'] || headers['authorization'] || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    // ========== 从请求体尝试拿 RefreshToken（可选，兜底） ==========
    let refreshToken = '';
    let phoneNumberFromBody = '';
    if (body) {
        try {
            const jsonBody = JSON.parse(body);
            refreshToken = jsonBody.RefreshToken || jsonBody.refreshToken || '';
            phoneNumberFromBody = jsonBody.Tel || jsonBody.PhoneNumber || jsonBody.phoneNumber || '';
        } catch (e) {}
    }

    // ========== 从 JWT 解析手机号 ==========
    let phoneNumber = phoneNumberFromBody;
    if (!phoneNumber && token) {
        const jwtPhone = extractPhoneFromJwt(token);
        if (jwtPhone) phoneNumber = jwtPhone;
    }

    // ========== 读已有数据 ==========
    let authData = {};
    const existing = $prefs.valueForKey(tokenKey);
    if (existing) {
        try { authData = JSON.parse(existing); } catch (e) {}
    }
    authData.deviceInfo = authData.deviceInfo || {};

    // ========== 只更新 Token、jwtInfo、PhoneNumber ==========
    let updated = false;

    if (token) {
        authData.token = token;
        authData.jwtInfo = parseJwt(token);
        updated = true;
        console.log(`[${cookieName}] Token 已更新`);
    }

    if (phoneNumber) {
        authData.deviceInfo.PhoneNumber = phoneNumber;
        updated = true;
    }

    // 如果请求体里有 RefreshToken（RefreshToken 接口），也顺手更新一下
    // 但注意：这只是兜底，真正最新的 RefreshToken 由 yuwell_body_resp.js 从响应体拿
    if (refreshToken && !authData.deviceInfo.RefreshToken) {
        authData.deviceInfo.RefreshToken = refreshToken;
        updated = true;
        console.log(`[${cookieName}] RefreshToken（兜底）已写入`);
    }

    if (!updated) {
        console.log(`[${cookieName}] 未提取到有效数据，跳过`);
        return $done({});
    }

    // ========== 保存 ==========
    authData.timestamp = new Date().toISOString();
    $prefs.setValueForKey(JSON.stringify(authData), tokenKey);

    const jwtInfo = authData.jwtInfo || {};
    console.log(`[${cookieName}] 捕获成功:`);
    console.log(`  手机号: ${phoneNumber || '未获取'}`);
    console.log(`  Token: ${token ? '已获取' : '未获取'}`);
    console.log(`  有效期: ${jwtInfo.expireTime || '未知'}`);
    console.log(`  剩余: ${jwtInfo.remainHours ?? '未知'}h`);

    $notify(`✅ ${cookieName}`,
            phoneNumber ? `手机号: ${phoneNumber}` : '⚠️ 数据不完整',
            `Token: ${token ? '已捕获' : '无'}\n剩余: ${jwtInfo.remainHours ?? '未知'}h`);

    $done({});
}

// ========== 辅助函数 ==========

function extractPhoneFromJwt(token) {
    try {
        if (!token) return '';
        const parts = token.split('.');
        if (parts.length !== 3) return '';
        const payload = JSON.parse(decodeBase64(parts[1]));
        return payload.UserName || payload.phone || payload.sub || '';
    } catch (e) { return ''; }
}

function parseJwt(token) {
    try {
        if (!token || token.split('.').length !== 3) return null;
        const payload = JSON.parse(decodeBase64(token.split('.')[1]));
        const exp = payload.exp || payload.expiration;
        const nbf = payload.nbf;
        const now = Date.now();
        return {
            phone: payload.UserName || payload.phone || '',
            uid: payload.id || payload.uid || '',
            nbf: nbf ? new Date(nbf * 1000).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}) : '未知',
            expireTime: exp ? new Date(exp * 1000).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}) : '未知',
            expired: exp ? (exp * 1000 < now) : true,
            notBefore: nbf ? (nbf * 1000 > now) : false,
            remainHours: exp ? Math.floor((exp * 1000 - now) / 3600000) : 0
        };
    } catch (e) { return null; }
}

function decodeBase64(str) {
    try {
        if (typeof atob !== 'undefined') return atob(str);
        const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let result = '';
        let i = 0;
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (i < str.length) {
            const a = base64Chars.indexOf(str.charAt(i++));
            const b = base64Chars.indexOf(str.charAt(i++));
            const c = base64Chars.indexOf(str.charAt(i++));
            const d = base64Chars.indexOf(str.charAt(i++));
            const bytes = (a << 18) | (b << 12) | (c << 6) | d;
            result += String.fromCharCode((bytes >> 16) & 0xFF);
            if (c !== 64) {
                result += String.fromCharCode((bytes >> 8) & 0xFF);
                if (d !== 64) result += String.fromCharCode(bytes & 0xFF);
            }
        }
        return decodeURIComponent(escape(result));
    } catch (e) { return str; }
}

handleRequest();