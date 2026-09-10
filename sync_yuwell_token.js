// sync_yuwell_token.js - 同步鱼跃Token到青龙（开放平台版 V3）
// 部署位置: Quantumult X Scripts 目录
// 青龙配置从 $prefs 读取 (ql_url, ql_client_id, ql_client_secret)
// 使用青龙开放平台 /open/* 接口
// 关键：PUT /open/envs 路径不带 /{id}，id 放在 body 里

const tokenKey = 'yuwell_token';
const tokenEnvName = 'YUWELL_AUTHORIZATION';
const deviceEnvName = 'YUWELL_DEVICE_INFO';

// ========== 从 $prefs 读取青龙配置 ==========
const qlConfig = {
    url: ($prefs.valueForKey('ql_url') || 'http://10.0.0.3:5700').replace(/\/+$/, ''),
    clientId: $prefs.valueForKey('ql_client_id') || '',
    clientSecret: $prefs.valueForKey('ql_client_secret') || ''
};

console.log(`[版本检查] V3，${new Date().toISOString()}`);
console.log(`[青龙] URL: ${qlConfig.url}`);
console.log(`[青龙] ClientID: ${qlConfig.clientId ? '已设置' : '未设置'}`);
console.log(`[青龙] ClientSecret: ${qlConfig.clientSecret ? '已设置' : '未设置'}`);

// ========== 通用请求封装（QX 用 $task.fetch） ==========
function qxFetch(options) {
    return $task.fetch({
        url: options.url,
        method: (options.method || 'GET').toUpperCase(),
        headers: options.headers || {},
        body: options.body
    });
}

// ========== 获取青龙 OpenAPI Token ==========
function getQlToken() {
    const url = `${qlConfig.url}/open/auth/token?client_id=${encodeURIComponent(qlConfig.clientId)}&client_secret=${encodeURIComponent(qlConfig.clientSecret)}`;
    return qxFetch({
        url: url,
        method: 'GET'
    }).then(resp => {
        let result;
        try {
            result = JSON.parse(resp.body);
        } catch (e) {
            throw new Error(`响应非JSON: ${(resp.body || '').substring(0, 120)}`);
        }
        if (result.code === 200) {
            return result.data.token;
        }
        throw new Error(`获取token失败: ${result.message || '未知错误'}`);
    }).catch(err => {
        throw new Error(`请求失败: ${err.error || err.message || err}`);
    });
}

// ========== 设备信息合并 ==========
function mergeDeviceInfo(existingDevice, newDevice) {
    const merged = { ...existingDevice };
    
    // 核心字段：直接更新
    ['RefreshToken', 'DeviceID', 'SingleDeviceID'].forEach(field => {
        if (newDevice[field] && String(newDevice[field]).trim() !== '') {
            merged[field] = newDevice[field];
        }
    });
    
    // App 标识字段：也更新
    ['UserAgent', 'AnytimeappVersion'].forEach(field => {
        if (newDevice[field] && String(newDevice[field]).trim() !== '') {
            merged[field] = newDevice[field];
        }
    });
    
    // PhoneNumber 保持不变
    // PhoneBrand、PhoneModel、OSversion、WebUserAgent 一律不更新，保留旧值
    return merged;
}

// ========== 更新 Token 环境变量 ==========
function updateEnv(qlToken, authData) {
    const newDeviceInfo = authData.deviceInfo || {};
    const phoneNumber = newDeviceInfo.PhoneNumber || '';

    console.log(`[同步] 开始更新账号: ${phoneNumber || '未知'}`);

    const searchUrl = `${qlConfig.url}/open/envs?searchValue=${encodeURIComponent(tokenEnvName)}`;

    return qxFetch({
        url: searchUrl,
        method: 'GET',
        headers: {'Authorization': `Bearer ${qlToken}`}
    }).then(resp => {
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
                console.log(`   [Token] 添加新Token`);
            }
            envValue = filtered.join('|');
            console.log(`   [Token] 现有 ${oldTokens.length} 个，更新后 ${filtered.length} 个`);
        }

        let url = `${qlConfig.url}/open/envs`;
        let method = 'POST';
        let body;

        if (existingEnv) {
            // PUT：路径不带 /{id}，id 放 body 里
            url = `${qlConfig.url}/open/envs`;
            method = 'PUT';
            body = {
                id: existingEnv.id,
                name: tokenEnvName,
                value: envValue,
                remarks: existingEnv.remarks || `鱼跃JWT - ${phoneNumber || '未知'}`
            };
        } else {
            // POST 新建：数组
            body = [{
                name: tokenEnvName,
                value: envValue,
                remarks: `鱼跃JWT - ${phoneNumber || '未知'} ${new Date().toLocaleString()}`
            }];
        }

        return qxFetch({
            url: url,
            method: method,
            headers: {
                'Authorization': `Bearer ${qlToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
    }).then(resp => {
        let result;
        try {
            result = JSON.parse(resp.body);
        } catch (e) {
            throw new Error(`Token更新响应非JSON: ${(resp.body || '').substring(0, 120)}`);
        }
        if (result.code === 200) {
            console.log(`   [Token] 更新成功`);
            return updateDeviceInfo(qlToken, newDeviceInfo);
        }
        throw new Error(`更新Token失败: ${result.message}`);
    });
}

// ========== 更新设备信息环境变量（保持 | 分隔格式） ==========
function updateDeviceInfo(qlToken, newDeviceInfo) {
    const searchUrl = `${qlConfig.url}/open/envs?searchValue=${encodeURIComponent(deviceEnvName)}`;

    return qxFetch({
        url: searchUrl,
        method: 'GET',
        headers: {'Authorization': `Bearer ${qlToken}`}
    }).then(resp => {
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
            } catch (e) {
                console.log(`   [设备] 解析失败: ${e.message}`);
            }
        }

        const phoneNumber = newDeviceInfo.PhoneNumber || '';
        let existingIndex = -1;

        if (phoneNumber) {
            existingIndex = existingDevices.findIndex(d => d.PhoneNumber === phoneNumber);
        }

        if (existingIndex >= 0) {
            console.log(`   [设备] 更新已有账号: ${phoneNumber}`);
            existingDevices[existingIndex] = mergeDeviceInfo(existingDevices[existingIndex], newDeviceInfo);
        } else if (phoneNumber && /^1\d{10}$/.test(phoneNumber)) {
            console.log(`   [设备] 新增账号: ${phoneNumber}`);
            existingDevices.push({ ...newDeviceInfo, PhoneNumber: phoneNumber });
        } else {
            console.log(`   [设备] 跳过: 缺少有效手机号`);
            return;
        }

        // 保持 | 分隔格式
        const newValue = existingDevices.map(d => JSON.stringify(d)).join('|');

        let url = `${qlConfig.url}/open/envs`;
        let method = 'POST';
        let body;

        if (existingEnv) {
            // PUT：路径不带 /{id}，id 放 body 里
            url = `${qlConfig.url}/open/envs`;
            method = 'PUT';
            body = {
                id: existingEnv.id,
                name: deviceEnvName,
                value: newValue,
                remarks: existingEnv.remarks || `鱼跃设备信息 (${existingDevices.length}个设备)`
            };
        } else {
            // POST 新建：数组
            body = [{
                name: deviceEnvName,
                value: newValue,
                remarks: `鱼跃设备信息 (${existingDevices.length}个设备)`
            }];
        }

        return qxFetch({
            url: url,
            method: method,
            headers: {
                'Authorization': `Bearer ${qlToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        }).then(resp => {
            let result;
            try {
                result = JSON.parse(resp.body);
            } catch (e) {
                throw new Error(`设备更新响应非JSON: ${(resp.body || '').substring(0, 120)}`);
            }
            if (result.code !== 200) {
                throw new Error(`设备更新失败: ${result.message}`);
            }
            console.log(`   [设备] 更新完成 (${existingDevices.length}个设备)`);
        });
    });
}

// ========== 从 JWT 解析手机号 ==========
function extractPhoneFromJwt(token) {
    try {
        if (!token) return '';
        const parts = token.split('.');
        if (parts.length !== 3) return '';
        const payload = JSON.parse(decodeBase64(parts[1]));
        return payload.UserName || payload.phone || '';
    } catch (e) { return ''; }
}

// ========== Base64 解码 ==========
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
            const d = base64Chars.charAt(i++) ? base64Chars.indexOf(str.charAt(i-1)) : 64;
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

// ========== 主流程 ==========
function main() {
    console.log(`[同步] 开始执行...`);

    if (!qlConfig.url || !qlConfig.clientId || !qlConfig.clientSecret) {
        const msg = '青龙配置不完整，请检查 ql_url, ql_client_id, ql_client_secret';
        console.log(`[同步] ❌ ${msg}`);
        $notify('❌ 配置错误', '', msg);
        return;
    }

    const authDataStr = $prefs.valueForKey(tokenKey);
    if (!authDataStr) {
        console.log(`[同步] ❌ 未找到数据`);
        $notify('❌ 未找到数据', '', '请先打开鱼跃安耐糖App');
        return;
    }

    let authData;
    try {
        authData = JSON.parse(authDataStr);
    } catch (e) {
        console.log(`[同步] ❌ 数据解析失败: ${e.message}`);
        $notify('❌ 数据解析失败', '', e.message);
        return;
    }

    const deviceInfo = authData.deviceInfo || {};
    const phoneNumber = deviceInfo.PhoneNumber || '未知';

    console.log(`[同步] 手机号: ${phoneNumber}`);
    console.log(`[同步] Token: ${authData.token ? '已获取' : '无'}`);
    console.log(`[同步] DeviceID: ${deviceInfo.DeviceID || '无'}`);

    if (!authData.token && !deviceInfo.DeviceID) {
        console.log(`[同步] ❌ 数据不完整`);
        $notify('❌ 数据不完整', '', '请重新捕获');
        return;
    }

    console.log(`[同步] 获取青龙Token...`);
    getQlToken().then(qlToken => {
        console.log(`[同步] ✅ 青龙Token获取成功`);
        console.log(`[同步] 开始更新环境变量...`);
        return updateEnv(qlToken, authData);
    }).then(() => {
        const jwtInfo = authData.jwtInfo || {};
        const expireTime = jwtInfo.expireTime || '未知';
        const remainHours = jwtInfo.remainHours ?? '未知';

        console.log(`[同步] ✅ 同步完成`);
        $notify('✅ 同步成功',
            `鱼跃安耐糖 - ${phoneNumber}`,
            `Token: ${authData.token ? '已更新' : '无'}\n有效期: ${expireTime}\n剩余: ${remainHours}h`);
    }).catch(error => {
        console.log(`[同步] ❌ 同步失败: ${error.message}`);
        $notify('❌ 同步失败', '', error.message);
    });
}

main();