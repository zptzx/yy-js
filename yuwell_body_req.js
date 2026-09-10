// yuwell_body_req.js - 抓请求头和请求体
// 覆盖：
//   - GetLastSingleDeviceID 请求头：Authorization(JWT)、User-Agent、AnytimeappVersion
//   - DataSync/DownloadData 请求体：DeviceID

const tokenKey = 'yuwell_token';

function handleRequest() {
    const url = $request.url || '';
    const headers = $request.headers || {};
    const body = $request.body;

    let authData = {};
    const existing = $prefs.valueForKey(tokenKey);
    if (existing) {
        try { authData = JSON.parse(existing); } catch (e) {}
    }
    authData.deviceInfo = authData.deviceInfo || {};

    let updated = false;

    // ========== 来源 1：GetLastSingleDeviceID 请求头 ==========
    if (/cgm\.yuwell\.com\/cgmapi\/Account\/GetLastSingleDeviceID/.test(url)) {
        console.log(`[鱼跃Req] GetLastSingleDeviceID 请求头`);

        const authHeader = headers['Authorization'] || headers['authorization'] || '';
        if (authHeader.startsWith('Bearer ')) {
            authData.token = authHeader.substring(7);
            authData.jwtInfo = parseJwt(authData.token);
            updated = true;
            console.log(`   [头] JWT: 已更新`);
        }

        const userAgent = headers['User-Agent'] || headers['user-agent'] || '';
        if (userAgent) {
            authData.deviceInfo.UserAgent = userAgent;
            updated = true;
            console.log(`   [头] UserAgent: ${userAgent}`);
        }

        const anytimeVersion = headers['AnytimeappVersion'] || headers['anytimeappversion'] || '';
        if (anytimeVersion) {
            authData.deviceInfo.AnytimeappVersion = anytimeVersion;
            updated = true;
            console.log(`   [头] AnytimeappVersion: ${anytimeVersion}`);
        }
    }

    // ========== 来源 2：DataSync/DownloadData 请求体 ==========
    if (/cgm\.yuwell\.com\/cgmapi\/DataSync\/DownloadData/.test(url)) {
        console.log(`[鱼跃Req] DataSync/DownloadData 请求体`);

        if (body) {
            try {
                const jsonBody = JSON.parse(body);
                const deviceId = jsonBody.DeviceID || jsonBody.deviceId || '';
                if (deviceId) {
                    authData.deviceInfo.DeviceID = deviceId;
                    updated = true;
                    console.log(`   [体] DeviceID: ${deviceId}`);
                }
            } catch (e) {
                console.log(`   [体] 解析失败: ${e.message}`);
            }
        }
    }

    if (updated) {
        authData.timestamp = new Date().toISOString();
        $prefs.setValueForKey(JSON.stringify(authData), tokenKey);
        console.log(`[鱼跃Req] 已保存`);
    }

    $done($request);
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