// ==UserScript==
// @name         J-Novel Club Chapter Ripper(ENG,FR,DE)
// @namespace    http://tampermonkey.net/
// @version      4.3
// @description  Downloads images from J-Novel Club to a folder. High performance, UI controls, deduplication, static counters, and guaranteed discovery ordering.
// @author       ozler365
// @license      MIT
// @match        https://labs.j-novel.club/embed/v2/*
// @match        https://api.jnc-nina.eu/embed/v2/*
// @icon         https://play-lh.googleusercontent.com/7nPAJjEXNWjxfQtG3JwwwEXGXm4Tr6ncoOkhzx27omrBQ8v1MmmEWGFZfxwcACX7iEo=w480-h960
// @grant        GM_download
// @run-at       document-idle
// @downloadURL https://update.greasyfork.org/scripts/565173/J-Novel%20Club%20Chapter%20Ripper%28ENG%2CFR%2CDE%29.user.js
// @updateURL https://update.greasyfork.org/scripts/565173/J-Novel%20Club%20Chapter%20Ripper%28ENG%2CFR%2CDE%29.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // Configuration for performance tuning
    const CONFIG = {
        minSize: 10,           
        minFileSize: 30 * 1024, 
        scanInterval: 2000,    
        chunkSize: 30,         
        autoScan: true,        
        scrollDelay: 50,       
        autoDownload: true     
    };

    class ImageDownloader {
        constructor() {
            this.images = new Map(); 
            this.isScanning = false;
            this.scanTimer = null;
            this.currentState = 'SCROLL';
            this.isAutoScrolling = false;
            this.cachedTotalPages = 0;
            this.discoveryCounter = 0; 
            
            this.createUI();
            this.setupScrollDetection();
            this.setupUrlDetection();
            if (CONFIG.autoScan) this.startAutoScan();
            this.startConversionWorker();
        }

        createUI() {
            const menu = document.createElement('div');
            menu.id = 'jnovel-downloader-menu';
            menu.style.top = Math.max(20, (window.innerHeight / 2) - 180) + "px";
            menu.style.right = "20px";
            menu.style.left = "auto";

            menu.innerHTML = `
                <div class="menu-header" id="menu-drag-handle">
                    <span class="header-title">J-Novel Ripper</span>
                    <span id="minimize-btn" class="header-btn">—</span>
                </div>
                <div class="menu-content" id="menu-content">
                    <div class="status-row">
                        <span class="status-count" id="count-display">0 / 0</span>
                    </div>
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill" id="progress-fill"></div>
                        </div>
                    </div>
                    
                    <div class="slider-row">
                        <div class="slider-label">Scroll Speed: <span id="speed-display">${CONFIG.scrollDelay}</span>ms</div>
                        <input type="range" id="scroll-speed-slider" min="10" max="2000" step="10" value="${CONFIG.scrollDelay}">
                    </div>

                    <label class="toggle-row">
                        <input type="checkbox" id="auto-download-toggle" ${CONFIG.autoDownload ? 'checked' : ''}>
                        Enable Auto-Download
                    </label>
                    
                    <div class="button-group">
                        <button id="action-btn" class="btn-download">
                            Start Auto Scroll
                        </button>
                        <button id="force-download-btn" class="btn-download btn-force">
                            Save to Folder Now
                        </button>
                    </div>

                    <div style="text-align:center; margin-top:2px;">
                        <a href="https://buymeacoffee.com/ozler" target="_blank" style="color:#10b981; text-decoration:none; font-size:11px; font-weight:bold;">☕ Support Developer</a>
                    </div>
                </div>
            `;

            const style = document.createElement('style');
            style.textContent = `
                #jnovel-downloader-menu {
                    position: fixed; width: 230px;
                    background: #fff; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.15);
                    z-index: 999999; font-family: sans-serif; font-size: 13px;
                    overflow: hidden; display: flex; flex-direction: column;
                }
                .menu-header {
                    background: #1f2937; color: #fff; padding: 10px 12px;
                    display: flex; justify-content: space-between; align-items: center;
                    cursor: grab; user-select: none;
                }
                .menu-header:active { cursor: grabbing; }
                .header-title { font-weight: 600; font-size: 14px; }
                .header-btn { cursor: pointer; font-weight: bold; padding: 0 4px; }
                .header-btn:hover { color: #10b981; }
                .menu-content { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
                .status-row { display: flex; justify-content: center; align-items: center; color: #4b5563; }
                .status-count { font-family: monospace; font-weight: 600; font-size: 14px; }
                .progress-container { width: 100%; background: #e5e7eb; border-radius: 3px; overflow: hidden; height: 6px; }
                .progress-fill { height: 100%; background: #667eea; width: 0%; transition: width 0.3s ease; }
                
                .slider-row { display: flex; flex-direction: column; gap: 4px; }
                .slider-label { font-size: 12px; color: #4b5563; font-weight: 600; }
                #scroll-speed-slider { width: 100%; cursor: pointer; }
                
                .toggle-row { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #4b5563; cursor: pointer; }
                
                .button-group { display: flex; flex-direction: column; gap: 6px; }
                .btn-download {
                    width: 100%; padding: 8px; border: none; border-radius: 6px;
                    background: #10b981; color: #fff; font-weight: 600; cursor: pointer;
                }
                .btn-download:hover { background: #059669; }
                .btn-download:disabled { background: #9ca3af; cursor: wait; }
                
                .btn-force { background: #3b82f6; }
                .btn-force:hover { background: #2563eb; }
            `;

            document.head.appendChild(style);
            document.body.appendChild(menu);
            
            const dragHandle = document.getElementById('menu-drag-handle');
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;
            
            dragHandle.onmousedown = (e) => {
                if(e.target.id === 'minimize-btn') return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                initialLeft = menu.offsetLeft;
                initialTop = menu.offsetTop;
            };
            
            document.onmousemove = (e) => {
                if (!isDragging) return;
                e.preventDefault();
                menu.style.left = (initialLeft + e.clientX - startX) + "px";
                menu.style.top = (initialTop + e.clientY - startY) + "px";
                menu.style.right = "auto";
                menu.style.bottom = "auto";
            };
            
            document.onmouseup = () => { isDragging = false; };

            const minBtn = document.getElementById('minimize-btn');
            const content = document.getElementById('menu-content');
            minBtn.onclick = () => {
                if (content.style.display === 'none') {
                    content.style.display = 'flex';
                    minBtn.textContent = '—';
                } else {
                    content.style.display = 'none';
                    minBtn.textContent = '□';
                }
            };

            const speedSlider = document.getElementById('scroll-speed-slider');
            const speedDisplay = document.getElementById('speed-display');
            speedSlider.oninput = (e) => {
                CONFIG.scrollDelay = parseInt(e.target.value, 10);
                speedDisplay.textContent = CONFIG.scrollDelay;
            };

            const toggle = document.getElementById('auto-download-toggle');
            toggle.onchange = (e) => {
                CONFIG.autoDownload = e.target.checked;
            };

            document.getElementById('action-btn').addEventListener('click', async () => {
                if (this.currentState === 'SCROLL') {
                    await this.performAutoScroll();
                } else if (this.currentState === 'SCROLLING') {
                    this.isAutoScrolling = false;
                    this.resetButtons(document.getElementById('action-btn'), document.getElementById('force-download-btn'));
                } else if (this.currentState === 'DOWNLOAD') {
                    await this.performDownload(false);
                }
            });

            document.getElementById('force-download-btn').addEventListener('click', async () => {
                await this.performDownload(true);
            });
        }

        setupScrollDetection() {
            let scrollTimeout;
            window.addEventListener('scroll', () => {
                if (!CONFIG.autoScan) return;
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => { if (!this.isScanning) this.scanPage(); }, 500);
            }, { passive: true });
        }

        setupUrlDetection() {
            let lastUrl = location.href;
            setInterval(() => {
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    this.images.clear();
                    this.cachedTotalPages = 0; 
                    this.discoveryCounter = 0; 
                    this.updateUI();
                }
            }, 1000);
        }

        startAutoScan() {
            if (this.scanTimer) clearInterval(this.scanTimer);
            this.scanTimer = setInterval(() => { if (!this.isScanning && CONFIG.autoScan) this.scanPage(); }, CONFIG.scanInterval);
        }

        getTotalExpectedImages() {
            if (this.cachedTotalPages > 0) return this.cachedTotalPages;
            
            const el = document.querySelector('.br-slider__pagenum-last');
            if (el) {
                const num = parseInt(el.textContent.trim(), 10);
                if (!isNaN(num) && num > 0) {
                    this.cachedTotalPages = num;
                    return num;
                }
            }
            return 0;
        }

        getSeriesTitle() {
            let series = '';
            let chapter = '';
            
            const seriesEl = document.querySelector('.br-toolbar__ellipsis');
            if (seriesEl) series = seriesEl.textContent.trim();
            
            const volEl = document.querySelector('#br-chapter__group');
            if (volEl) {
                const volSpan = volEl.querySelector('#br-chapter__volume');
                if (volSpan) chapter = volSpan.textContent.trim();
                
                const selectEl = volEl.querySelector('select#br-chapter');
                if (selectEl && selectEl.options[selectEl.selectedIndex]) {
                    const optText = selectEl.options[selectEl.selectedIndex].text.trim();
                    if (!chapter.includes(optText)) {
                        chapter += " " + optText;
                    }
                }
            }

            let title = `${series} - ${chapter}`.trim();
            if (title === '-' || title === '') title = document.title || "J-Novel_Download";
            
            title = title.replace(/[\\/:*?"<>|]/g, "_").trim();
            return title || "J-Novel_Images";
        }

        isValidImage(url, width, height) {
            if (!url) return false;
            
            const lowerUrl = url.toLowerCase();
            if (lowerUrl.includes('loading') || lowerUrl.includes('spinner') || lowerUrl.startsWith('data:image/gif')) return false;

            if (url.startsWith('data:') && url.length < 1000) return false; 
            
            return !(width > 0 && height > 0 && width < CONFIG.minSize && height < CONFIG.minSize);
        }

        async scanPage() {
            if (this.isScanning) return;
            this.isScanning = true;

            const seen = new Set(this.images.keys());
            const allElements = Array.from(document.querySelectorAll('img, canvas'));
            const newImages = [];

            for (let i = 0; i < allElements.length; i += CONFIG.chunkSize) {
                const chunk = allElements.slice(i, i + CONFIG.chunkSize);
                
                chunk.forEach(el => {
                    let src = null, w = 0, h = 0;
                    
                    if (el.tagName === 'IMG') {
                        src = el.dataset.src || el.getAttribute('data-src') || el.src;
                        w = el.naturalWidth;
                        h = el.naturalHeight;
                    } else if (el.tagName === 'CANVAS') {
                        try { src = el.toDataURL(); w = el.width; h = el.height; } catch(e){}
                    }

                    if (!src) return;
                    if (!src.startsWith('data:') && !src.startsWith('blob:') && !src.startsWith('http')) {
                        try { src = new URL(src, window.location.href).href; } catch { return; }
                    }

                    if (src && !seen.has(src) && this.isValidImage(src, w, h)) {
                        // Priority 1: Pull correct sequence from aria-label
                        let pageNum = this.discoveryCounter++;
                        const ariaLabel = el.getAttribute('aria-label');
                        if (ariaLabel) {
                            const match = ariaLabel.match(/\d+/);
                            if (match) pageNum = parseInt(match[0], 10);
                        }

                        newImages.push({ 
                            url: src, 
                            width: w, 
                            height: h, 
                            blob: null, 
                            converting: false,
                            orderId: pageNum
                        });
                    }
                });
                
                await new Promise(r => requestAnimationFrame(r));
            }

            if (newImages.length > 0) {
                newImages.forEach(img => this.images.set(img.url, img));
                this.updateUI();
            }
            
            this.isScanning = false;
        }

        async convertToBlob(url) {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = () => {
                    try {
                        const canvas = document.createElement("canvas");
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        canvas.getContext("2d").drawImage(img, 0, 0);
                        canvas.toBlob((blob) => {
                            resolve(blob);
                        }, 'image/png');
                    } catch (e) { resolve(null); }
                };
                img.onerror = () => resolve(null);
                img.src = url;
            });
        }

        async startConversionWorker() {
            while (true) {
                const target = Array.from(this.images.values()).find(img => !img.blob && !img.converting);
                
                if (target) {
                    target.converting = true;
                    const blob = await this.convertToBlob(target.url);
                    if (blob) {
                        target.blob = blob;
                        this.updateUI();
                    } else {
                        target.converting = false;
                    }
                    await new Promise(r => setTimeout(r, 20));
                } else {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }

        async generateHash(blob) {
            const buffer = await blob.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        async performAutoScroll() {
            const actionBtn = document.getElementById('action-btn');
            const forceBtn = document.getElementById('force-download-btn');
            
            this.currentState = 'SCROLLING';
            this.isAutoScrolling = true;
            actionBtn.textContent = 'Stop Auto Scroll';
            actionBtn.style.backgroundColor = '#ffa502';
            forceBtn.disabled = true;

            window.scrollTo(0, 0);
            await new Promise(r => setTimeout(r, 1000));

            let lastScrollTop = -1;
            let scrollAttempts = 0;

            while (this.isAutoScrolling) {
                const visibleContainers = Array.from(document.querySelectorAll('.item')).filter(div => {
                    const rect = div.getBoundingClientRect();
                    return rect.top < (window.innerHeight + 150) && rect.bottom > -150;
                });

                let newlyLoaded = false;

                for (const container of visibleContainers) {
                    let waitAttempts = 0;
                    while (waitAttempts < 150) {
                        if (!this.isAutoScrolling) return;
                        
                        const canvas = container.querySelector('canvas.page-img, img');
                        if (canvas) {
                            if (canvas.dataset.scrollProcessed === "true") {
                                break;
                            }

                            const hAttr = canvas.getAttribute('height');
                            
                            if (hAttr && hAttr !== "0" && parseInt(hAttr, 10) > 0) {
                                canvas.dataset.scrollProcessed = "true";
                                newlyLoaded = true; 
                                break; 
                            }
                        }
                        
                        await new Promise(r => setTimeout(r, 100));
                        waitAttempts++;
                    }
                }

                if (newlyLoaded) {
                    await new Promise(r => setTimeout(r, 1500)); 
                }

                window.scrollBy(0, window.innerHeight * 0.7);
                await new Promise(r => setTimeout(r, CONFIG.scrollDelay));

                await this.scanPage();

                const expected = this.getTotalExpectedImages();
                const done = Array.from(this.images.values()).filter(img => img.blob && img.blob.size >= CONFIG.minFileSize).length;
                const reachedMax = (expected > 0 && done >= expected);
                let reachedBottom = false;

                if (window.scrollY === lastScrollTop) {
                    scrollAttempts++;
                    if (scrollAttempts >= 3) reachedBottom = true;
                } else {
                    scrollAttempts = 0;
                }
                
                lastScrollTop = window.scrollY;

                if (reachedMax || reachedBottom) {
                    this.isAutoScrolling = false;
                    break;
                }
            }

            // Only proceed if script hasn't been manually halted
            if (this.currentState === 'SCROLLING') {
                forceBtn.disabled = false;

                if (CONFIG.autoDownload) {
                    await this.performDownload(false);
                } else {
                    this.currentState = 'DOWNLOAD';
                    actionBtn.textContent = 'Save to Folder';
                    actionBtn.style.backgroundColor = '#10b981';
                    actionBtn.disabled = false;
                }
            }
        }

        async performDownload(triggeredByForceBtn = false) {
            const actionBtn = document.getElementById('action-btn');
            const forceBtn = document.getElementById('force-download-btn');
            
            this.currentState = 'DOWNLOADING';
            actionBtn.disabled = true;
            forceBtn.disabled = true;

            if (triggeredByForceBtn) {
                forceBtn.textContent = 'Saving to Folder...';
            } else {
                actionBtn.textContent = 'Saving to Folder...';
            }

            const readyImages = Array.from(this.images.values())
                .filter(img => img.blob && img.blob.size >= CONFIG.minFileSize)
                .sort((a, b) => a.orderId - b.orderId); // Employs aria-label number sequencing
            
            if (readyImages.length === 0) { 
                alert('No valid images captured yet (images may be loading or under 30KB). Ensure chapter is fully loaded.'); 
                this.resetButtons(actionBtn, forceBtn);
                return; 
            }

            try {
                const title = this.getSeriesTitle();
                const uniqueHashes = new Set();
                let addedCount = 0;

                for (let i = 0; i < readyImages.length; i++) {
                    const img = readyImages[i];
                    const hash = await this.generateHash(img.blob);
                    
                    if (!uniqueHashes.has(hash)) {
                        uniqueHashes.add(hash);
                        const ext = 'png';
                        
                        // Output filename retains absolute order regardless of discovery time
                        const filename = `${title}/page${String(img.orderId).padStart(3, '0')}.${ext}`;
                        
                        const blobUrl = URL.createObjectURL(img.blob);
                        
                        GM_download({
                            url: blobUrl,
                            name: filename,
                            saveAs: false,
                            onload: () => URL.revokeObjectURL(blobUrl),
                            onerror: () => URL.revokeObjectURL(blobUrl)
                        });
                        
                        addedCount++;
                        await new Promise(r => setTimeout(r, 60));
                    }
                }
                
                if (triggeredByForceBtn) {
                    forceBtn.textContent = 'Done!';
                } else {
                    actionBtn.textContent = 'Done!';
                }
            } catch (e) {
                console.error("Download Error:", e);
                alert('Error saving files to folder.');
            }

            setTimeout(() => {
                this.resetButtons(actionBtn, forceBtn);
            }, 3000);
        }

        resetButtons(actionBtn, forceBtn) {
            this.currentState = 'SCROLL';
            actionBtn.textContent = 'Start Auto Scroll';
            actionBtn.style.backgroundColor = '#10b981';
            actionBtn.disabled = false;
            forceBtn.textContent = 'Save to Folder Now';
            forceBtn.disabled = false;
        }

        updateUI() {
            requestAnimationFrame(() => {
                const expected = this.getTotalExpectedImages();
                
                const done = Array.from(this.images.values()).filter(img => img.blob && img.blob.size >= CONFIG.minFileSize).length;
                
                const displayTotal = expected > 0 ? expected : Math.max(done, 1);
                const displayDone = Math.min(done, displayTotal);
                
                document.getElementById('count-display').textContent = `${displayDone} / ${displayTotal}`;
                
                const pct = (displayDone / displayTotal) * 100;
                document.getElementById('progress-fill').style.width = `${Math.min(pct, 100)}%`;
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new ImageDownloader());
    } else {
        new ImageDownloader();
    }
})();