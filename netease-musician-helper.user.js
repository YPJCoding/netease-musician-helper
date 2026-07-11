// ==UserScript==
// @name         网易音乐人发布动态
// @namespace    https://github.com/YPJCoding/netease-musician-helper
// @version      1.0.0
// @description  在网易云音乐自动发布图文笔记（配乐动态），发布成功后自动删除，仅用于完成音乐人任务指标。
// @author       YPJCoding
// @license      MIT
// @homepageURL  https://github.com/YPJCoding/netease-musician-helper
// @supportURL   https://github.com/YPJCoding/netease-musician-helper/issues
// @match        https://music.163.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    "use strict";

    // ===================== 选择器与常量 =====================
    const SELECTORS = {
        pubEvent: "#pubEvent",
        noteTextarea: "textarea.u-txt.area.j-flag[placeholder='一起聊聊吧~']",
        addMusicText: "给笔记配上音乐",
        musicSearch: ".m-lysearch input.u-txt.txt.j-flag",
        searchResult: ".srchlist li.sitm",
        shareBtn: "a.u-btn2.u-btn2-2.u-btn2-w2.j-flag[data-action='share']",
        deleteUnfold: "[data-action='unfold']",
        deleteBtn: "[data-action='delete']",
        deleteOk: "[data-action='ok']",
    };

    const DEFAULTS = {
        keyword: "你好",
        waitSeconds: 10,
        msgTemplate: () => {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            return `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())} 分享音乐`;
        },
    };

    // ===================== 工具函数 =====================

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /** 获取当前页面及其所有同源 iframe 的 document 列表 */
    function getFrameDocuments() {
        const docs = [document];
        const iframes = document.querySelectorAll("iframe");
        for (const iframe of iframes) {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc) docs.push(doc);
            } catch (_) { /* 跨域 iframe，跳过 */ }
        }
        return docs;
    }

    /** 跨 frame 查找第一个匹配的元素 */
    function findInFrames(selector) {
        for (const doc of getFrameDocuments()) {
            const el = doc.querySelector(selector);
            if (el) return el;
        }
        return null;
    }

    /** 跨 frame 按文本精确查找元素（XPath） */
    function findTextInFrames(text) {
        const xpath = `.//*[normalize-space(text())='${text}']`;
        for (const doc of getFrameDocuments()) {
            const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            if (result.singleNodeValue) return result.singleNodeValue;
        }
        return null;
    }

    /** 填写表单并派发 input/change 事件（兼容 React 受控组件） */
    function safeType(el, value) {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // ===================== 发布流程 =====================

    async function doPublish(msg, keyword, deleteAfter) {
        // Step 1: 点击发笔记按钮
        updateStatus("正在查找发笔记按钮...", "info");
        const pubBtn = findInFrames(SELECTORS.pubEvent);
        if (!pubBtn) {
            updateStatus("未找到发布按钮，请确认已登录且位于动态页", "error");
            return;
        }
        pubBtn.click();
        await sleep(1500);
        updateStatus("已点击发笔记按钮", "info");

        // Step 2: 填写文案
        const textarea = findInFrames(SELECTORS.noteTextarea);
        if (!textarea) {
            updateStatus("未找到笔记文本框，页面结构可能已变更", "error");
            return;
        }
        safeType(textarea, msg);
        await sleep(500);
        updateStatus(`已填入文案：${msg.slice(0, 20)}...`, "info");

        // Step 3: 点击"给笔记配上音乐"
        const addMusicBtn = findTextInFrames(SELECTORS.addMusicText);
        if (addMusicBtn) {
            addMusicBtn.click();
            await sleep(800);

            // Step 4: 搜索并选中配乐
            const searchInput = findInFrames(SELECTORS.musicSearch);
            if (searchInput) {
                safeType(searchInput, keyword);
                searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                await sleep(2000);
                updateStatus("正在搜索配乐...", "info");

                const firstResult = findInFrames(SELECTORS.searchResult);
                if (firstResult) {
                    firstResult.click();
                    updateStatus(`已选择配乐（关键词: ${keyword}）`, "info");
                } else {
                    updateStatus("未找到搜索结果，跳过配乐", "warn");
                }
            } else {
                updateStatus("未找到音乐搜索框，跳过配乐", "warn");
            }
        } else {
            updateStatus('未找到「给笔记配上音乐」按钮，跳过配乐', "warn");
        }

        // Step 5: 点击分享发布
        const shareBtn = findInFrames(SELECTORS.shareBtn);
        if (!shareBtn) {
            updateStatus("未找到分享按钮，发布失败", "error");
            return;
        }
        shareBtn.click();
        updateStatus("已点击分享，等待页面渲染...", "info");
        await sleep(3000);

        // 通过 DOM 中是否出现删除按钮来判断发布成功
        const delCheck = findInFrames(SELECTORS.deleteBtn);
        if (!delCheck) {
            updateStatus("发布后未找到删除按钮，可能发布失败", "error");
            return;
        }
        updateStatus(`发布成功，${deleteAfter} 秒后自动删除...`, "success");

        // Step 6: 等待后删除
        for (let i = deleteAfter; i > 0; i--) {
            updateStatus(`发布成功，${i} 秒后自动删除...`, "success");
            await sleep(1000);
        }

        await doDeleteEvent();
    }

    // ===================== 删除流程 =====================

    /** 同源删除动态：展开管理菜单 → 点删除 → 确认 */
    async function doDeleteEvent() {
        updateStatus("正在删除动态...", "info");

        for (const doc of getFrameDocuments()) {
            const delBtn = doc.querySelector(SELECTORS.deleteBtn);
            if (!delBtn) continue;

            // 1) 展开管理菜单
            const unfoldBtn = doc.querySelector(SELECTORS.deleteUnfold);
            if (unfoldBtn) {
                try { unfoldBtn.click(); await sleep(400); } catch (_) {}
            }

            // 2) 点击删除
            try {
                delBtn.click();
            } catch (_) {
                delBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }
            await sleep(400);

            // 3) 确认删除
            const okBtn = doc.querySelector(SELECTORS.deleteOk);
            if (okBtn) {
                okBtn.click();
            } else {
                const result = doc.evaluate(
                    `.//*[normalize-space(text())='确定']`, doc, null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE, null
                );
                if (result.singleNodeValue) result.singleNodeValue.click();
            }

            updateStatus("删除完成", "success");
            return;
        }

        updateStatus("未找到删除入口，请手动删除", "warn");
    }

    // ===================== 浮动面板 UI =====================

    let panelVisible = true;

    function updateStatus(text, level) {
        const el = document.getElementById("nm-status");
        if (!el) return;
        const colors = { info: "#1890ff", success: "#52c41a", error: "#ff4d4f", warn: "#faad14" };
        el.textContent = text;
        el.style.color = colors[level] || "#666";
    }

    /** 面板拖拽（全局仅绑定一次 document 事件，避免泄漏） */
    let _dragPanel = null;
    let _dragInstalled = false;
    let _dragData = { dragging: false, startX: 0, startY: 0, startLeft: 0, startTop: 0 };

    function _installDragOnce() {
        if (_dragInstalled) return;
        _dragInstalled = true;

        document.addEventListener("mousemove", (e) => {
            if (!_dragData.dragging || !_dragPanel) return;
            const d = _dragData;
            _dragPanel.style.right = "auto";
            _dragPanel.style.left = d.startLeft + e.clientX - d.startX + "px";
            _dragPanel.style.top = d.startTop + e.clientY - d.startY + "px";
        });

        document.addEventListener("mouseup", () => {
            if (_dragData.dragging) {
                _dragData.dragging = false;
                if (_dragPanel) {
                    _dragPanel.style.transition = "transform 0.2s, opacity 0.2s";
                }
            }
        });
    }

    function _attachDragTo(panel) {
        _dragPanel = panel;
        _installDragOnce();

        const header = document.getElementById("nm-panel-header");
        if (!header) return;
        header.addEventListener("mousedown", (e) => {
            _dragData.dragging = true;
            _dragData.startX = e.clientX;
            _dragData.startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            _dragData.startLeft = rect.left;
            _dragData.startTop = rect.top;
            panel.style.transition = "none";
            e.preventDefault();
        });
    }

    /** 注入浮动控制面板到页面 */
    function injectPanel() {
        if (document.getElementById("nm-publish-panel")) return;

        const panel = document.createElement("div");
        panel.id = "nm-publish-panel";
        panel.innerHTML = `
            <div id="nm-panel-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;cursor:move;">
                <span style="font-size:14px;font-weight:bold;color:#333;user-select:none;">发布动态</span>
                <span id="nm-toggle-btn" style="cursor:pointer;font-size:16px;line-height:1;user-select:none;" title="折叠/展开">−</span>
            </div>
            <div id="nm-panel-body">
                <div style="margin-bottom:8px;">
                    <label style="font-size:12px;color:#999;">文案内容</label>
                    <textarea id="nm-msg" rows="3" style="width:100%;margin-top:4px;padding:6px 8px;border:1px solid #e8e8e8;border-radius:4px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>
                </div>
                <div style="margin-bottom:8px;">
                    <label style="font-size:12px;color:#999;">配乐搜索关键词</label>
                    <input id="nm-keyword" style="width:100%;margin-top:4px;padding:6px 8px;border:1px solid #e8e8e8;border-radius:4px;font-size:13px;box-sizing:border-box;" />
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:12px;color:#999;">发布后删除等待（秒）</label>
                    <input id="nm-wait" type="number" min="1" max="120" style="width:100%;margin-top:4px;padding:6px 8px;border:1px solid #e8e8e8;border-radius:4px;font-size:13px;box-sizing:border-box;" />
                </div>
                <button id="nm-publish-btn" style="width:100%;padding:8px 0;background:#ec4141;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer;font-weight:500;">发布动态</button>
                <div id="nm-status" style="margin-top:10px;font-size:12px;color:#999;line-height:1.5;word-break:break-all;"></div>
            </div>
        `;

        Object.assign(panel.style, {
            position: "fixed", top: "120px", right: "16px", zIndex: "99999",
            width: "280px", background: "#fff", borderRadius: "8px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.12)", padding: "16px",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            transition: "transform 0.2s, opacity 0.2s",
        });

        document.body.appendChild(panel);

        // 设置默认值
        document.getElementById("nm-msg").value = DEFAULTS.msgTemplate();
        document.getElementById("nm-keyword").value = DEFAULTS.keyword;
        document.getElementById("nm-wait").value = DEFAULTS.waitSeconds;

        // 发布按钮
        document.getElementById("nm-publish-btn").addEventListener("click", () => {
            const msg = document.getElementById("nm-msg").value.trim() || DEFAULTS.msgTemplate();
            const keyword = document.getElementById("nm-keyword").value.trim() || DEFAULTS.keyword;
            const wait = Math.max(1, parseInt(document.getElementById("nm-wait").value) || DEFAULTS.waitSeconds);
            document.getElementById("nm-publish-btn").disabled = true;
            document.getElementById("nm-publish-btn").textContent = "执行中...";
            doPublish(msg, keyword, wait).finally(() => {
                document.getElementById("nm-publish-btn").disabled = false;
                document.getElementById("nm-publish-btn").textContent = "发布动态";
            });
        });

        // 折叠/展开按钮
        document.getElementById("nm-toggle-btn").addEventListener("click", () => {
            const body = document.getElementById("nm-panel-body");
            const btn = document.getElementById("nm-toggle-btn");
            if (panelVisible) {
                body.style.display = "none";
                btn.textContent = "+";
                panel.style.width = "auto";
                panel.style.padding = "8px 16px";
            } else {
                body.style.display = "block";
                btn.textContent = "−";
                panel.style.width = "280px";
                panel.style.padding = "16px";
            }
            panelVisible = !panelVisible;
        });

        // 拖拽（document 事件仅绑定一次，不随 injectPanel 重复绑定）
        _attachDragTo(panel);
    }

    // ===================== URL 变化检测 =====================

    function isFriendPage() {
        return /#\/friend/.test(location.hash);
    }

    function handleUrlChange() {
        const panel = document.getElementById("nm-publish-panel");
        if (isFriendPage()) {
            if (!panel) injectPanel();
            else panel.style.display = "";
        } else {
            if (panel) panel.style.display = "none";
        }
    }

    // ===================== 入口 =====================

    if (isFriendPage()) injectPanel();
    window.addEventListener("hashchange", handleUrlChange);
})();
