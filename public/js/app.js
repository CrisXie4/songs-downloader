// 网易云音乐下载器 - 主应用
const { createApp, ref, reactive, onMounted } = Vue;

createApp({
    setup() {
        const AGREEMENT_VERSION = '2.0';
        const AGREEMENT_STORAGE_KEY = `wyym_downloader_agreement_accepted_${AGREEMENT_VERSION}`;

        const activeTab = ref('playlist');
        const loading = ref(false);
        const downloading = ref(false);
        const toast = ref(null);
        const downloadProgress = ref(null);

        const agreementAccepted = ref(false);
        const showAgreementModal = ref(false);
        const agreementChecked = ref(false);

        // Playlist state
        const playlistInput = ref('');
        const playlistData = ref(null);
        const selectedSongs = ref([]);

        // Single song state
        const singleInput = ref('');
        const singleName = ref('');
        const singleArtists = ref('');

        // Settings state
        const settings = reactive({
            apiSource: 'original',
            musicSource: 'netease',
            musicQuality: '999'
        });

        const qqKeyword = ref('');
        const qqType = ref('song');
        const qqQuality = ref('128');
        const qqSongResults = ref(null);
        const qqSelectedMids = ref([]);
        const qqRawResult = ref(null);

        const qqQualityOptions = [
            { label: '128k', value: '128' },
            { label: '320k', value: '320' },
            { label: 'FLAC', value: 'flac' }
        ];

        const musicSources = [
            { id: 'netease', name: '网易云音乐' },
            { id: 'kuwo', name: '酷我音乐' },
            { id: 'joox', name: 'JOOX' },
            { id: 'tencent', name: 'QQ音乐' },
            { id: 'kugou', name: '酷狗音乐' },
            { id: 'migu', name: '咪咕音乐' }
        ];

        const qualityOptions = [
            { label: '128k', value: '128' },
            { label: '192k', value: '192' },
            { label: '320k', value: '320' },
            { label: '740k', value: '740' },
            { label: '999k', value: '999' }
        ];

        const showToast = (message, type = 'success') => {
            toast.value = { message, type };
            setTimeout(() => {
                toast.value = null;
            }, 3000);
        };

        const safeLocalStorageGet = (key) => {
            try {
                return window.localStorage.getItem(key);
            } catch (_) {
                return null;
            }
        };

        const safeLocalStorageSet = (key, value) => {
            try {
                window.localStorage.setItem(key, value);
            } catch (_) {
                // ignore
            }
        };

        const syncAgreementState = () => {
            agreementAccepted.value = safeLocalStorageGet(AGREEMENT_STORAGE_KEY) === '1';
            showAgreementModal.value = !agreementAccepted.value;
            document.body.style.overflow = showAgreementModal.value ? 'hidden' : '';
        };

        const acceptAgreement = () => {
            if (!agreementChecked.value) return;
            safeLocalStorageSet(AGREEMENT_STORAGE_KEY, '1');
            agreementAccepted.value = true;
            showAgreementModal.value = false;
            document.body.style.overflow = '';
        };

        const declineAgreement = () => {
            showToast('未同意法律声明，无法继续使用', 'error');
            window.location.href = '/pages/legal.html';
        };

        const requireAgreement = () => {
            if (showAgreementModal.value) {
                showToast('请先阅读并同意法律声明', 'error');
                return false;
            }
            return true;
        };

        onMounted(async () => {
            syncAgreementState();
            try {
                const response = await fetch('/api/config');
                const data = await response.json();
                settings.apiSource = data.api_source;
                settings.musicSource = data.music_source;
                settings.musicQuality = data.music_quality;
            } catch (e) {
                console.error('Failed to load config', e);
            }
        });

        const fetchPlaylist = async () => {
            if (!requireAgreement()) return;
            if (!playlistInput.value) return;
            loading.value = true;
            playlistData.value = null;

            try {
                const response = await fetch('/api/playlist/fetch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: playlistInput.value })
                });

                const result = await response.json();

                if (result.status === 'success') {
                    playlistData.value = result.data;
                    selectedSongs.value = playlistData.value.songs.map(s => s.id);
                    showToast(`找到 ${playlistData.value.songs.length} 首歌曲`);
                } else {
                    showToast(result.message || '获取歌单失败', 'error');
                }
            } catch (e) {
                showToast('网络请求失败', 'error');
            } finally {
                loading.value = false;
            }
        };

        const selectAll = () => {
            if (playlistData.value) {
                selectedSongs.value = playlistData.value.songs.map(s => s.id);
            }
        };

        const selectNone = () => {
            selectedSongs.value = [];
        };

        const downloadSelected = async () => {
            if (!requireAgreement()) return;
            if (selectedSongs.value.length === 0) return;
            downloading.value = true;

            let successCount = 0;
            let failCount = 0;
            const totalSongs = selectedSongs.value.length;

            downloadProgress.value = {
                current: 0,
                total: totalSongs,
                currentSong: ''
            };

            for (const songId of selectedSongs.value) {
                const song = playlistData.value.songs.find(s => s.id === songId);
                if (!song) continue;

                downloadProgress.value.currentSong = song.name;

                try {
                    const href = `/api/download/file?id=${encodeURIComponent(song.id)}&name=${encodeURIComponent(song.name)}&artists=${encodeURIComponent(song.artists)}`;
                    const link = document.createElement('a');
                    link.href = href;
                    link.style.display = 'none';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    successCount++;
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (e) {
                    failCount++;
                    console.error(`Error downloading ${song.name}:`, e);
                }

                downloadProgress.value.current++;
            }

            downloading.value = false;
            downloadProgress.value = null;

            if (failCount === 0) {
                showToast(`全部下载完成！共 ${successCount} 首`, 'success');
            } else {
                showToast(`下载完成: 成功 ${successCount} 首, 失败 ${failCount} 首`, 'warning');
            }
        };

        const downloadSingle = async () => {
            if (!requireAgreement()) return;
            if (!singleInput.value) return;
            downloading.value = true;

            try {
                // 首先获取歌曲信息
                const infoResponse = await fetch('/api/single/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: singleInput.value })
                });

                const infoResult = await infoResponse.json();
                if (infoResult.status !== 'success') {
                    showToast(infoResult.message || '无效的链接', 'error');
                    downloading.value = false;
                    return;
                }

                const songId = infoResult.id;

                const href = `/api/download/file?id=${encodeURIComponent(songId)}&name=${encodeURIComponent(singleName.value)}&artists=${encodeURIComponent(singleArtists.value)}`;
                const link = document.createElement('a');
                link.href = href;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                showToast('歌曲下载已开始', 'success');
                singleInput.value = '';
                singleName.value = '';
                singleArtists.value = '';
            } catch (e) {
                showToast('网络请求失败', 'error');
            } finally {
                downloading.value = false;
            }
        };

        const saveSettings = async () => {
            if (!requireAgreement()) return;
            try {
                const response = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiSource: settings.apiSource,
                        musicSource: settings.musicSource,
                        musicQuality: settings.musicQuality
                    })
                });

                const result = await response.json();
                if (result.status === 'success') {
                    showToast('配置已保存');
                } else {
                    showToast('保存失败', 'error');
                }
            } catch (e) {
                showToast('保存配置出错', 'error');
            }
        };

        const qqSearch = async () => {
            if (!requireAgreement()) return;
            const keyword = String(qqKeyword.value || '').trim();
            if (!keyword) return;

            loading.value = true;
            qqSongResults.value = null;
            qqSelectedMids.value = [];
            qqRawResult.value = null;

            try {
                const params = new URLSearchParams({
                    keyword,
                    type: qqType.value || 'song',
                    num: '20',
                    page: '1'
                });
                const response = await fetch(`/api/qq/search?${params.toString()}`);
                const result = await response.json();

                qqRawResult.value = JSON.stringify(result, null, 2);

                if (qqType.value === 'song') {
                    const list = result?.data?.list;
                    if (!Array.isArray(list) || list.length === 0) {
                        showToast('未找到歌曲', 'warning');
                        return;
                    }

                    qqSongResults.value = list.map(item => {
                        const artists = Array.isArray(item?.singer) ? item.singer.map(s => s?.name).filter(Boolean).join(', ') : '';
                        const album = item?.album?.name ? String(item.album.name) : '';
                        return {
                            mid: String(item?.mid || ''),
                            name: String(item?.name || ''),
                            artists,
                            album
                        };
                    }).filter(s => s.mid);

                    qqSelectedMids.value = qqSongResults.value.map(s => s.mid);
                    showToast(`找到 ${qqSongResults.value.length} 首歌曲`);
                } else {
                    showToast('查询成功');
                }
            } catch (e) {
                showToast('网络请求失败', 'error');
            } finally {
                loading.value = false;
            }
        };

        const qqSelectAll = () => {
            if (qqSongResults.value) {
                qqSelectedMids.value = qqSongResults.value.map(s => s.mid);
            }
        };

        const qqSelectNone = () => {
            qqSelectedMids.value = [];
        };

        const qqDownloadSelected = async () => {
            if (!requireAgreement()) return;
            if (!Array.isArray(qqSelectedMids.value) || qqSelectedMids.value.length === 0) return;
            if (!Array.isArray(qqSongResults.value) || qqSongResults.value.length === 0) return;

            downloading.value = true;

            let successCount = 0;
            let failCount = 0;
            const totalSongs = qqSelectedMids.value.length;

            downloadProgress.value = {
                current: 0,
                total: totalSongs,
                currentSong: ''
            };

            for (const mid of qqSelectedMids.value) {
                const song = qqSongResults.value.find(s => s.mid === mid);
                if (!song) continue;

                downloadProgress.value.currentSong = song.name;

                try {
                    const href = `/api/qq/download/file?mid=${encodeURIComponent(song.mid)}&quality=${encodeURIComponent(qqQuality.value)}&name=${encodeURIComponent(song.name)}&artists=${encodeURIComponent(song.artists)}`;
                    const link = document.createElement('a');
                    link.href = href;
                    link.style.display = 'none';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    successCount++;
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (e) {
                    failCount++;
                }

                downloadProgress.value.current++;
            }

            downloading.value = false;
            downloadProgress.value = null;

            if (failCount === 0) {
                showToast(`全部下载完成！共 ${successCount} 首`, 'success');
            } else {
                showToast(`下载完成: 成功 ${successCount} 首, 失败 ${failCount} 首`, 'warning');
            }
        };

        return {
            activeTab,
            loading,
            downloading,
            toast,
            downloadProgress,
            agreementAccepted,
            showAgreementModal,
            agreementChecked,
            acceptAgreement,
            declineAgreement,
            playlistInput,
            playlistData,
            selectedSongs,
            singleInput,
            singleName,
            singleArtists,
            settings,
            musicSources,
            qualityOptions,
            qqKeyword,
            qqType,
            qqQuality,
            qqQualityOptions,
            qqSongResults,
            qqSelectedMids,
            qqRawResult,
            fetchPlaylist,
            selectAll,
            selectNone,
            downloadSelected,
            downloadSingle,
            saveSettings,
            qqSearch,
            qqSelectAll,
            qqSelectNone,
            qqDownloadSelected
        };
    }
}).mount('#app');
