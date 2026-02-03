const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const port = 5000;

app.use(cors());
app.use(bodyParser.json());

// 静态文件服务 - 指向public目录
app.use(express.static(path.join(__dirname, 'public')));

// Configuration defaults
let config = {
    api_source: 'original',  // 'original' or 'gdstudio'
    music_source: 'netease',
    music_quality: '999'
};

const PROJECT_ROOT = path.dirname(__dirname);
const CONFIG_FILE = path.join(PROJECT_ROOT, '.config.json');

const QQ_API_BASE = 'https://api.ygking.top/api';

/**
 * 加载配置文件
 */
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            const savedConfig = JSON.parse(data);
            config = { ...config, ...savedConfig };
            console.log('配置已加载:', config);
        }
    } catch (e) {
        console.error(`加载配置失败: ${e.message}`);
    }
}

/**
 * 保存配置文件
 */
function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log('配置已保存');
    } catch (e) {
        console.error(`保存配置失败: ${e.message}`);
    }
}

/**
 * 从输入中提取歌单ID
 */
function extractPlaylistId(input) {
    input = input.trim();
    const idMatch = input.match(/[?&]id=(\d+)/);
    if (idMatch) return idMatch[1];

    const playlistMatch = input.match(/playlist[/=](\d+)/);
    if (playlistMatch) return playlistMatch[1];

    if (/^\d+$/.test(input)) return input;
    return null;
}

/**
 * 从输入中提取歌曲ID
 */
function extractSongId(input) {
    input = input.trim();
    const idMatch = input.match(/[?&]id=(\d+)/);
    if (idMatch) return idMatch[1];

    const songMatch = input.match(/song[/=](\d+)/);
    if (songMatch) return songMatch[1];

    if (/^\d+$/.test(input)) return input;
    return null;
}

/**
 * 清理文件名，移除非法字符
 */
function sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
}

function contentDispositionHeader(filename) {
    const fallback = filename.replace(/[^\x20-\x7E]/g, '_');
    const encoded = encodeURIComponent(filename);
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function buildFilenameWithExt({ id, name, artists, ext }) {
    let baseName = name ? String(name).trim() : '';
    let baseArtists = artists ? String(artists).trim() : '';

    if (baseName && !baseArtists) {
        baseArtists = '未知作者';
    }

    let filename = '';
    if (baseName && baseArtists) {
        filename = `${baseName}-${baseArtists}`;
    } else if (baseName) {
        filename = baseName;
    } else {
        filename = `song_${id}`;
    }

    filename = sanitizeFilename(filename);
    if (!filename) {
        filename = `song_${id}`;
    }

    const safeExt = ext ? String(ext).trim().replace(/^\.+/ , '') : '';
    return safeExt ? `${filename}.${safeExt}` : filename;
}

function buildFilename({ id, name, artists }) {
    return buildFilenameWithExt({ id, name, artists, ext: 'mp3' });
}

async function qqApiGet(endpointPath, params) {
    const url = `${QQ_API_BASE}${endpointPath}`;
    const response = await axios.get(url, {
        params,
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0'
        }
    });
    return response.data;
}

function normalizeQqSongUrlFromResponse(mid, payload) {
    const data = payload?.data ?? payload;
    if (!data) return null;
    if (typeof data === 'string') return data;
    if (typeof data?.url === 'string' && data.url) return data.url;
    if (mid && typeof data?.[mid]?.url === 'string' && data[mid].url) return data[mid].url;
    if (mid && typeof data?.[mid] === 'string' && data[mid]) return data[mid];
    if (Array.isArray(data)) {
        const first = data.find(item => typeof item?.url === 'string' && item.url);
        if (first?.url) return first.url;
    }
    return null;
}

function normalizeQqQuality(value) {
    const v = String(value || '').toLowerCase();
    if (v === '128' || v === '320' || v === 'flac') return v;
    return '128';
}

function guessAudioExt({ quality, contentType }) {
    const q = String(quality || '').toLowerCase();
    if (q === 'flac') return 'flac';
    const ct = String(contentType || '').toLowerCase();
    if (ct.includes('flac')) return 'flac';
    if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
    if (ct.includes('aac')) return 'm4a';
    if (ct.includes('ogg')) return 'ogg';
    return 'mp3';
}

// 启动时加载配置
loadConfig();

// 首页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 获取配置
app.get('/api/config', (req, res) => {
    res.json(config);
});

// 保存配置
app.post('/api/config', (req, res) => {
    const data = req.body;
    if (data) {
        config.api_source = data.apiSource || config.api_source;
        config.music_source = data.musicSource || config.music_source;
        config.music_quality = data.musicQuality || config.music_quality;
        saveConfig();
    }
    res.json({ status: 'success', config });
});

// 获取歌单详情
app.post('/api/playlist/fetch', async (req, res) => {
    const { url } = req.body;
    const playlistId = extractPlaylistId(url);

    if (!playlistId) {
        return res.status(400).json({
            status: 'error',
            message: '无法识别歌单ID，请检查输入格式'
        });
    }

    try {
        console.log(`正在获取歌单: ${playlistId}`);
        const response = await axios.get('https://www.oiapi.net/api/NeteasePlaylistDetail', {
            params: { id: playlistId },
            timeout: 10000
        });

        const result = response.data;
        if (result.code !== 1) {
            return res.status(400).json({
                status: 'error',
                message: '获取歌单失败，请检查歌单ID是否正确'
            });
        }

        const songs = result.data.map(song => ({
            id: song.id,
            name: song.name,
            artists: song.artists.map(a => a.name).join(', ')
        }));

        console.log(`成功获取歌单，共 ${songs.length} 首歌曲`);

        res.json({
            status: 'success',
            data: { songs }
        });
    } catch (e) {
        console.error('获取歌单失败:', e.message);
        res.status(500).json({
            status: 'error',
            message: '服务器请求失败: ' + e.message
        });
    }
});

// 获取单曲信息
app.post('/api/single/info', (req, res) => {
    const { url } = req.body;
    const songId = extractSongId(url);

    if (songId) {
        res.json({ status: 'success', id: songId });
    } else {
        res.status(400).json({
            status: 'error',
            message: '无效的歌曲链接或ID'
        });
    }
});

/**
 * 获取下载URL - 返回直接下载链接给前端，不在服务器存储
 */
app.post('/api/download/url', async (req, res) => {
    const { id, name, artists } = req.body;

    if (!id) {
        return res.status(400).json({
            status: 'error',
            message: '缺少歌曲ID'
        });
    }

    try {
        console.log(`正在获取歌曲下载链接: ${id}`);
        let audioLink = null;

        // 根据配置选择API源
        if (config.api_source === 'gdstudio') {
            const resp = await axios.get('https://music-api.gdstudio.xyz/api.php', {
                params: {
                    types: 'url',
                    source: config.music_source,
                    id: id,
                    br: config.music_quality
                },
                timeout: 10000
            });
            audioLink = resp.data.url;
        } else {
            const resp = await axios.get('https://api.paugram.com/netease', {
                params: { id: id, title: 'true' },
                timeout: 10000
            });
            audioLink = resp.data.link;
        }

        if (!audioLink) {
            return res.status(404).json({
                status: 'error',
                message: '未找到音频链接，该歌曲可能因版权原因无法下载'
            });
        }

        const filename = buildFilename({ id, name, artists });

        console.log(`成功获取下载链接: ${filename}`);

        // 返回下载URL和文件名，让前端直接下载
        res.json({
            status: 'success',
            url: audioLink,
            filename: filename
        });

    } catch (e) {
        console.error('获取下载链接失败:', e.message);
        res.status(500).json({
            status: 'error',
            message: '获取下载链接失败: ' + e.message
        });
    }
});

/**
 * 直接触发浏览器下载（同源代理），避免跨域链接无法应用 download 文件名
 */
app.get('/api/download/file', async (req, res) => {
    const id = req.query.id;
    const name = req.query.name || '';
    const artists = req.query.artists || '';

    if (!id) {
        return res.status(400).json({
            status: 'error',
            message: '缺少歌曲ID'
        });
    }

    try {
        let audioLink = null;

        if (config.api_source === 'gdstudio') {
            const resp = await axios.get('https://music-api.gdstudio.xyz/api.php', {
                params: {
                    types: 'url',
                    source: config.music_source,
                    id: id,
                    br: config.music_quality
                },
                timeout: 10000
            });
            audioLink = resp.data.url;
        } else {
            const resp = await axios.get('https://api.paugram.com/netease', {
                params: { id: id, title: 'true' },
                timeout: 10000
            });
            audioLink = resp.data.link;
        }

        if (!audioLink) {
            return res.status(404).json({
                status: 'error',
                message: '未找到音频链接，该歌曲可能因版权原因无法下载'
            });
        }

        const filename = buildFilename({ id, name, artists });

        const upstream = await axios.get(audioLink, {
            responseType: 'stream',
            timeout: 20000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
        res.setHeader('Content-Disposition', contentDispositionHeader(filename));
        res.setHeader('Cache-Control', 'no-store');

        upstream.data.on('error', () => {
            if (!res.headersSent) {
                res.status(502).end();
            } else {
                res.end();
            }
        });

        upstream.data.pipe(res);
    } catch (e) {
        const message = e?.message ? String(e.message) : '下载失败';
        res.status(500).json({
            status: 'error',
            message: '下载失败: ' + message
        });
    }
});

app.get('/api/qq/search', async (req, res) => {
    const keyword = String(req.query.keyword || '').trim();
    const type = String(req.query.type || 'song').trim();
    const num = req.query.num;
    const page = req.query.page;

    if (!keyword) {
        return res.status(400).json({
            status: 'error',
            message: '缺少 keyword'
        });
    }

    try {
        const data = await qqApiGet('/search', {
            keyword,
            type,
            num,
            page
        });
        res.json(data);
    } catch (e) {
        res.status(502).json({
            status: 'error',
            message: 'QQ API 请求失败: ' + (e?.message || 'unknown')
        });
    }
});

app.get('/api/qq/song/url', async (req, res) => {
    const mid = String(req.query.mid || '').trim();
    const quality = normalizeQqQuality(req.query.quality);

    if (!mid) {
        return res.status(400).json({
            status: 'error',
            message: '缺少 mid'
        });
    }

    try {
        const data = await qqApiGet('/song/url', {
            mid,
            quality
        });
        res.json(data);
    } catch (e) {
        res.status(502).json({
            status: 'error',
            message: 'QQ API 请求失败: ' + (e?.message || 'unknown')
        });
    }
});

app.get('/api/qq/song/detail', async (req, res) => {
    const mid = String(req.query.mid || '').trim();
    const id = req.query.id;

    if (!mid && !id) {
        return res.status(400).json({
            status: 'error',
            message: '缺少 mid 或 id'
        });
    }

    try {
        const data = await qqApiGet('/song/detail', {
            mid: mid || undefined,
            id: id || undefined
        });
        res.json(data);
    } catch (e) {
        res.status(502).json({
            status: 'error',
            message: 'QQ API 请求失败: ' + (e?.message || 'unknown')
        });
    }
});

app.get('/api/qq/song/cover', async (req, res) => {
    const mid = String(req.query.mid || '').trim();
    const album_mid = req.query.album_mid;
    const size = req.query.size;
    const validate = req.query.validate;

    if (!mid && !album_mid) {
        return res.status(400).json({
            status: 'error',
            message: '缺少 mid 或 album_mid'
        });
    }

    try {
        const data = await qqApiGet('/song/cover', {
            mid: mid || undefined,
            album_mid: album_mid || undefined,
            size: size || undefined,
            validate: validate || undefined
        });
        res.json(data);
    } catch (e) {
        res.status(502).json({
            status: 'error',
            message: 'QQ API 请求失败: ' + (e?.message || 'unknown')
        });
    }
});

app.get('/api/qq/lyric', async (req, res) => {
    const mid = String(req.query.mid || '').trim();
    const id = req.query.id;
    const qrc = req.query.qrc;
    const trans = req.query.trans;
    const roma = req.query.roma;

    if (!mid && !id) {
        return res.status(400).json({
            status: 'error',
            message: '缺少 mid 或 id'
        });
    }

    try {
        const data = await qqApiGet('/lyric', {
            mid: mid || undefined,
            id: id || undefined,
            qrc: qrc || undefined,
            trans: trans || undefined,
            roma: roma || undefined
        });
        res.json(data);
    } catch (e) {
        res.status(502).json({
            status: 'error',
            message: 'QQ API 请求失败: ' + (e?.message || 'unknown')
        });
    }
});

app.get('/api/qq/album', async (req, res) => {
    const mid = String(req.query.mid || '').trim();
    if (!mid) {
        return res.status(400).json({
            status: 'error',
            message: '缺少 mid'
        });
    }

    try {
        const data = await qqApiGet('/album', { mid });
        res.json(data);
    } catch (e) {
        res.status(502).json({
            status: 'error',
            message: 'QQ API 请求失败: ' + (e?.message || 'unknown')
        });
    }
});

app.get('/api/qq/playlist', async (req, res) => {
    const id = String(req.query.id || '').trim();
    if (!id) {
        return res.status(400).json({
            status: 'error',
            message: '缺少 id'
        });
    }

    try {
        const data = await qqApiGet('/playlist', { id });
        res.json(data);
    } catch (e) {
        res.status(502).json({
            status: 'error',
            message: 'QQ API 请求失败: ' + (e?.message || 'unknown')
        });
    }
});

app.get('/api/qq/singer', async (req, res) => {
    const mid = String(req.query.mid || '').trim();
    if (!mid) {
        return res.status(400).json({
            status: 'error',
            message: '缺少 mid'
        });
    }

    try {
        const data = await qqApiGet('/singer', { mid });
        res.json(data);
    } catch (e) {
        res.status(502).json({
            status: 'error',
            message: 'QQ API 请求失败: ' + (e?.message || 'unknown')
        });
    }
});

app.get('/api/qq/top', async (req, res) => {
    const id = req.query.id;
    const num = req.query.num;

    try {
        const data = await qqApiGet('/top', {
            id: id || undefined,
            num: num || undefined
        });
        res.json(data);
    } catch (e) {
        res.status(502).json({
            status: 'error',
            message: 'QQ API 请求失败: ' + (e?.message || 'unknown')
        });
    }
});

app.get('/api/qq/download/file', async (req, res) => {
    const mid = String(req.query.mid || '').trim();
    const name = req.query.name || '';
    const artists = req.query.artists || '';
    const quality = normalizeQqQuality(req.query.quality);
    let audioLink = req.query.url ? String(req.query.url).trim() : '';

    if (!mid && !audioLink) {
        return res.status(400).json({
            status: 'error',
            message: '缺少 mid'
        });
    }

    try {
        if (!audioLink) {
            const payload = await qqApiGet('/song/url', {
                mid,
                quality
            });
            audioLink = normalizeQqSongUrlFromResponse(mid, payload);
        }

        if (!audioLink) {
            return res.status(404).json({
                status: 'error',
                message: '未找到播放链接（可能需要会员或歌曲受限）'
            });
        }

        const upstream = await axios.get(audioLink, {
            responseType: 'stream',
            timeout: 25000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const ext = guessAudioExt({ quality, contentType: upstream.headers['content-type'] });
        const filename = buildFilenameWithExt({ id: mid || 'qq_song', name, artists, ext });

        res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
        res.setHeader('Content-Disposition', contentDispositionHeader(filename));
        res.setHeader('Cache-Control', 'no-store');

        upstream.data.on('error', () => {
            if (!res.headersSent) {
                res.status(502).end();
            } else {
                res.end();
            }
        });

        upstream.data.pipe(res);
    } catch (e) {
        const message = e?.message ? String(e.message) : '下载失败';
        res.status(500).json({
            status: 'error',
            message: '下载失败: ' + message
        });
    }
});

/**
 * 健康检查接口
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        version: '2.0',
        config: config
    });
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        status: 'error',
        message: '服务器内部错误'
    });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({
        status: 'error',
        message: '未找到请求的资源'
    });
});

// 启动服务器
app.listen(port, () => {
    console.log('========================================');
    console.log(`🎵 网易云音乐下载器 v2.0`);
    console.log(`🌐 服务器运行在: http://localhost:${port}`);
    console.log(`📝 当前配置:`, config);
    console.log(`⚠️  本工具仅供学习研究使用，请尊重版权`);
    console.log('========================================');
});