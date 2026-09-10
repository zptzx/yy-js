// yuwell_body_resp.js - 抓 GetLastSingleDeviceID 响应体，并立即同步到青龙
const tokenKey = 'yuwell_token';
const tokenEnvName = 'YUWELL_AUTHORIZATION';
const deviceEnvName = 'YUWELL_DEVICE_INFO';

// ========== 青龙配置 ==========
const qlConfig = {
    url: ($prefs.valueForKey('ql_url') || 'http://10.0.0.3:5700').replace(/\/+$/, ''),
    clientId: $prefs.valueForKey('ql_client_id') || '',
    clientSecret: $prefs.valueForKey('ql_client_secret') || ''
};

// ========== 主流程 ==========
function handleResponse() {
    const url = $request.url || '';
    const body = $response && $response.body;

    if (!/cgm\.yuwell\.com\/cgmapi\/Account\/GetLastSingleDeviceID/.test(url)) {
        return $done({});
    }

    if (!body) {
        console.log(`[鱼跃Resp] 响应体为空`);
        return $done({});
    }

    let jsonBody;
    try {
        jsonBody = JSON.parse(body);
    } catch (e) {
        console.log(`[鱼跃Resp] JSON 解析失败: ${e.message}`);
        return $done({});
    }

    console.log(`[鱼跃Resp] GetLastSingleDeviceID 响应体`);

    const data = jsonBody.Data || jsonBody.data || {};
    if (!data || Object.keys(data).length === 0) {
        console.log(`[鱼跃Resp] Data 为空`);
        return $done({});
    }

    let authData = {};
    const existing = $prefs.valueForKey(tokenKey);
    if (existing) {
        try { authData = JSON.parse(existing); } catch (e) {}
    }
    authData.deviceInfo = authData.deviceInfo || {};

    let updated = false;

    const refreshToken = data.RefreshToken || data.refreshToken || '';
    if (refreshToken) {
        authData.deviceInfo.RefreshToken = refreshToken;
        updated = true;
        console.log(`   RefreshToken: ${refreshToken.substring(0, 8)}...`);
    }

    const singleDeviceId = data.SingleDeviceId || data.SingleDeviceID || data.singleDeviceId || '';
    if (singleDeviceId) {
        authData.deviceInfo.SingleDeviceID = singleDeviceId;
        updated = true;
        console.log(`   SingleDeviceID: ${singleDeviceId}`);
    }

    const phoneNumber = data.Tel || data.tel || data.PhoneNumber || '';
    if (phoneNumber) {
        authData.deviceInfo.PhoneNumber = phoneNumber;
        updated = true;
        console.log(`   PhoneNumber: ${phoneNumber}`);
    }

    if (!updated) {
        console.log(`[鱼跃Resp] 无有效数据`);
        return $done({});
    }

    authData.timestamp = new Date().toISOString();
    $prefs.setValueForKey(JSON.stringify(authData), tokenKey);
    console.log(`[鱼跃Resp] 已保存到 $prefs`);

    // ========== 立即同步到青龙 ==========
    if (qlConfig.url && qlConfig.clientId && qlConfig.clientSecret) {
        console.log(`[鱼跃Resp] 触发立即同步...`);
        syncToQinglong().then(result => {
            console.log(`[立即同步] ${result.success ? '✅' : '❌'} ${result.message}`);
            $done({});
        }).catch(err => {
            console.log(`[立即同步] ❌ ${err.message}`);
            $done({});
        });
    } else {
        console.log(`[鱼跃Resp] 青龙配置不完整，跳过立即同步`);
        $done({});
    }
}

// ========== 青龙同步逻辑（内联） ==========
function qxFetch(options) {
    return $task.fetch({
        url: options.url,
        method: (options.method || 'GET').toUpperCase(),
        headers: options.headers || {},
        body: options.body
    });
}

function getQlToken() {
    const url = `${qlConfig.url}/open/auth/token?client_id=${encodeURIComponent(qlConfig.clientId)}&client_secret=${encodeURIComponent(qlConfig.clientSecret)}`;
    return qxFetch({url: url, method: 'GET'}).then(resp => {
        const result = JSON.parse(resp.body);
        if (result.code === 200) return result.data.token;
        throw new Error(`获取token失败: ${result.message}`);
    });
}

function syncToQinglong() {
    return new Promise((resolve) => {
        const authDataStr = $prefs.valueForKey(tokenKey);
        if (!authDataStr) return resolve({ success: false, message: '无数据' });
        let authData;
        try { authData = JSON.parse(authDataStr); } catch (e) {
            return resolve({ success: false, message: '解析失败' });
        }
        const deviceInfo = authData.deviceInfo || {};
        const phoneNumber = deviceInfo.PhoneNumber || '未知';

        getQlToken().then(qlToken => {
            return updateTokenEnv(qlToken, authData).then(() => updateDeviceEnv(qlToken, deviceInfo));
        }).then(() => {
            resolve({ success: true, message: `同步完成 ${phoneNumber}` });
        }).catch(e => {
            resolve({ success: false, message: e.message });
        });
    });
}

function updateTokenEnv(qlToken, authData) {
    const newDeviceInfo = authData.deviceInfo || {};
    const phoneNumber = newDeviceInfo.PhoneNumber || '';
    const searchUrl = `${qlConfig.url}/open/envs?searchValue=${encodeURIComponent(tokenEnvName)}`;

    return qxFetch({url: searchUrl, method: 'GET', headers: {'Authorization': `Bearer ${qlToken}`}}).then(resp => {
        const result = JSON.parse(resp.body);
        const envs = result.data || [];
        const existingEnv = envs.find(env => env.name === tokenEnvName);

        let envValue = authData.token || '';
        if (existingEnv && existingEnv.value) {
            const oldTokens = existingEnv.value.split('|').filter(t => t.trim());
            const filtered = oldTokens.filter(t => {
                const p = extractPhoneFromJwt(t);
                return p !== phoneNumber || t === authData.token;
            });
            if (!filtered.includes(authData.token) && authData.token) {
                filtered.push(authData.token);
            }
            envValue = filtered.join('|');
        }

        let url = `${qlConfig.url}/open/envs`;
        let method = 'POST';
        let body;
        if (existingEnv) {
            method = 'PUT';
            body = { id: existingEnv.id, name: tokenEnvName, value: envValue, remarks: existingEnv.remarks };
        } else {
            body = [{ name: tokenEnvName, value: envValue, remarks: `鱼跃JWT - ${phoneNumber}` }];
        }

        return qxFetch({
            url: url, method: method,
            headers: {'Authorization': `Bearer ${qlToken}`, 'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
    }).then(resp => {
        const result = JSON.parse(resp.body);
        if (result.code !== 200) throw new Error(`Token更新失败: ${result.message}`);
    });
}

function updateDeviceEnv(qlToken, newDeviceInfo) {
    const searchUrl = `${qlConfig.url}/open/envs?searchValue=${encodeURIComponent(deviceEnvName)}`;
    return qxFetch({url: searchUrl, method: 'GET', headers: {'Authorization': `Bearer ${qlToken}`}}).then(resp => {
        const result = JSON.parse(resp.body);
        const envs = result.data || [];
        const existingEnv = envs.find(env => env.name === deviceEnvName);

        let existingDevices = [];
        if (existingEnv && existingEnv.value) {
            try {
                if (existingEnv.value.trim().startsWith('[')) {
                    existingDevices = JSON.parse(existingEnv.value);
                } else {
                    existingDevices = existingEnv.value.split('|')
                        .filter(s => s.trim())
                        .map(s => { try { return JSON.parse(s); } catch(e) { return null; } })
                        .filter(Boolean);
                }
            } catch (e) {}
        }

        const phoneNumber = newDeviceInfo.PhoneNumber || '';
        let existingIndex = -1;
        if (phoneNumber) {
            existingIndex = existingDevices.findIndex(d => d.PhoneNumber === phoneNumber);
        }

        if (existingIndex >= 0) {
            existingDevices[existingIndex] = mergeDeviceInfo(existingDevices[existingIndex], newDeviceInfo);
        } else if (phoneNumber && /^1\d{10}$/.test(phoneNumber)) {
            existingDevices.push({ ...newDeviceInfo, PhoneNumber: phoneNumber });
        } else {
            return Promise.resolve();
        }

        const newValue = existingDevices.map(d => JSON.stringify(d)).join('|');

        let url = `${qlConfig.url}/open/envs`;
        let method = 'POST';
        let body;
        if (existingEnv) {
            method = 'PUT';
            body = { id: existingEnv.id, name: deviceEnvName, value: newValue, remarks: existingEnv.remarks };
        } else {
            body = [{ name: deviceEnvName, value: newValue, remarks: `鱼跃设备信息` }];
        }

        return qxFetch({
            url: url, method: method,
            headers: {'Authorization': `Bearer ${qlToken}`, 'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
    }).then(resp => {
        const result = JSON.parse(resp.body);
        if (result.code !== 200) throw new Error(`设备更新失败: ${result.message}`);
    });
}

function mergeDeviceInfo(existingDevice, newDevice) {
    const merged = { ...existingDevice };
    ['RefreshToken', 'DeviceID', 'SingleDeviceID', 'UserAgent', 'AnytimeappVersion'].forEach(field => {
        if (newDevice[field] && String(newDevice[field]).trim() !== '') {
            merged[field] = newDevice[field];
        }
    });
    return merged;
}

function extractPhoneFromJwt(token) {
    try {
        if (!token) return '';
        const parts = token.split('.');
        if (parts.length !== 3) return '';
        const payload = JSON.parse(decodeBase64(parts[1]));
        return payload.UserName || payload.phone || '';
    } catch (e) { return ''; }
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

handleResponse();