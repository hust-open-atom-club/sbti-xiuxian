/**
 * Lingen Test — main.js
 * Zero-dependency runtime for the xianxia-themed quiz.
 *
 * Exposes public functions on window.LingenTest namespace.
 * Production auto-bootstraps via DOMContentLoaded unless
 * window.LingenTest_SKIP_BOOTSTRAP is set before this script loads.
 */
(function (global) {
    'use strict';

    const LingenTest = {};

    /* ================================================================
       Constants
       ================================================================ */

    const WUXING  = ['金', '木', '水', '火', '土'];
    const PERSONA = ['躺平', 'emo', '社牛'];
    const WHITELIST_DIMS = new Set([].concat(WUXING, PERSONA));

    // DEC-1 default: disallow negative deltas.
    // Sign is +, digit 1-3. If the user later overrides DEC-1, extend this.
    const SEGMENT_RE        = /^(金|木|水|火|土|躺平|emo|社牛)([+])([1-3])$/;
    const QUESTION_HEADER_RE = /^##\s*Q(\d+)\s*$/;
    const PROMPT_LINE_RE     = /^>\s*(.+)$/;
    const SEPARATOR_RE       = /\s*[|,]\s*/;
    const HEX_COLOR_RE       = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

    const PORTRAIT_ACCESSORIES = new Set([
        'sword', 'staff', 'gourd', 'sword-water', 'cauldron', 'seal', 'fan', 'banner',
        'broken-sword', 'pillow', 'wine-gourd', 'wooden-fish', 'nothing'
    ]);
    const PORTRAIT_BACKGROUNDS = new Set([
        'waves', 'mist-waves', 'grass', 'flames', 'rocks', 'lightning', 'ice-flowers',
        'wind', 'dark-clouds', 'void', 'quilt', 'night-rain', 'crowd', 'blank'
    ]);

    // Tunable scoring thresholds. See spec §5.6 / plan feasibility hints.
    const PREFIX_THRESHOLD    = 3;
    const TIANLING_TOP        = 5;
    const TIANLING_SECOND_MAX = 1;
    const BIANLING_TOP        = 4;
    const BIANLING_SECOND     = 3;
    const ZHENLING_TOP        = 3;
    const ZHENLING_SECOND     = 2;
    const YINLING_TOTAL_MAX   = 3;
    const YINLING_PERSONA_MIN = 5;

    // Variant combinations (declared-order pair key; see DEC-2 A).
    const BIAN_COMBO = {
        '金_水': '雷',
        '水_土': '冰',
        '木_火': '风',
        '金_火': '暗'
    };

    /* ================================================================
       Utilities
       ================================================================ */

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str).replace(/[&<>"']/g, function (c) {
            return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
        });
    }

    async function loadMarkdown(path) {
        try {
            const res = await fetch(path);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.text();
        } catch (e) {
            if (typeof location !== 'undefined' && location.protocol === 'file:') {
                throw new Error(
                    '无法加载 ' + path + '（file:// 被浏览器阻止）。' +
                    '请改用 python3 -m http.server 启动本地服务器再访问。'
                );
            }
            throw new Error('题库加载失败：' + path + '（' + e.message + '）');
        }
    }

    /* ================================================================
       Parser — questions.md
       ================================================================ */

    function parseExpression(expr, qid, optIdx) {
        const segments = expr.split(SEPARATOR_RE)
            .map(function (s) { return s.trim(); })
            .filter(Boolean);
        if (segments.length === 0) {
            throw new Error('题库格式错误：Q' + qid + ' 选项 ' + optIdx + ' 分数表达式为空');
        }
        const deltas = {};
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const m = segment.match(SEGMENT_RE);
            if (!m) {
                const dimProbe = segment.replace(/[+\-0-9]+$/, '').trim();
                if (dimProbe && !WHITELIST_DIMS.has(dimProbe)) {
                    throw new Error(
                        '题库格式错误：Q' + qid + ' 选项 ' + optIdx +
                        ' 出现未知维度 "' + dimProbe + '"'
                    );
                }
                throw new Error(
                    '题库格式错误：Q' + qid + ' 选项 ' + optIdx +
                    ' 分数表达式不合法 "' + segment + '"'
                );
            }
            const dim = m[1];
            const digit = parseInt(m[3], 10);
            deltas[dim] = (deltas[dim] || 0) + digit;
        }
        return deltas;
    }

    function parseQuestions(text) {
        const lines = text.split(/\r?\n/);
        const questions = [];
        let current = null;

        function flush() {
            if (current === null) return;
            if (current.prompt.length === 0) {
                throw new Error('题库格式错误：Q' + current.id + ' 缺少题干');
            }
            if (current.options.length !== 3) {
                throw new Error(
                    '题库格式错误：Q' + current.id + ' 共 ' +
                    current.options.length + ' 个选项，期望 3'
                );
            }
            questions.push(current);
            current = null;
        }

        for (let idx = 0; idx < lines.length; idx++) {
            const trimmed = lines[idx].trim();
            if (trimmed === '') continue;
            // Skip H1 title at document level
            if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) continue;

            // Question header `## Q<n>`
            if (trimmed.startsWith('## ')) {
                const headerMatch = trimmed.match(QUESTION_HEADER_RE);
                if (headerMatch) {
                    flush();
                    current = { id: parseInt(headerMatch[1], 10), prompt: '', options: [] };
                    continue;
                }
                // Malformed `## Q...`
                if (/^##\s*Q/i.test(trimmed)) {
                    throw new Error('题库格式错误：题号格式不合法 "' + trimmed + '"');
                }
                // Other `## ` headers are ignored (intro sections)
                continue;
            }

            if (current === null) continue; // Intro blockquotes before first question

            // Prompt line starting with `>`
            if (trimmed.charAt(0) === '>') {
                const m = trimmed.match(PROMPT_LINE_RE);
                if (m) {
                    current.prompt = current.prompt
                        ? current.prompt + ' ' + m[1].trim()
                        : m[1].trim();
                }
                continue;
            }

            // Option line starting with `-`
            if (trimmed.charAt(0) === '-') {
                const body = trimmed.replace(/^-\s*/, '');
                const tickStart = body.indexOf('`');
                if (tickStart === -1) {
                    throw new Error(
                        '题库格式错误：Q' + current.id + ' 选项 ' +
                        (current.options.length + 1) + ' 缺少反引号分数表达式'
                    );
                }
                const tickEnd = body.indexOf('`', tickStart + 1);
                if (tickEnd === -1) {
                    throw new Error(
                        '题库格式错误：Q' + current.id + ' 选项 ' +
                        (current.options.length + 1) + ' 反引号未闭合'
                    );
                }
                let label = body.substring(0, tickStart).trim();
                label = label.replace(/[·•\s]+$/, '').trim();
                const expression = body.substring(tickStart + 1, tickEnd);
                const text = body.substring(tickEnd + 1).trim();
                const deltas = parseExpression(expression, current.id, current.options.length + 1);
                current.options.push({ label: label, text: text, deltas: deltas });
                continue;
            }
        }

        flush();
        return questions;
    }

    /* ================================================================
       Parser — results.md
       ================================================================ */

    function parseResults(text) {
        const lines = text.split(/\r?\n/);
        const dict = {};
        let current = null;
        let section = null; // 'meta' | '签文' | '推荐功法' | '画像'
        var seenKeys  = {};  // key → first displayName
        var seenNames = {};  // displayName → true
        var seenCodes = {};  // 结果代码 → first displayName

        function flush() {
            if (current === null) return;
            const required = ['key', '品阶', '属性', '前缀', '结果代码'];
            for (let i = 0; i < required.length; i++) {
                if (!current[required[i]]) {
                    throw new Error(
                        '结果字典格式错误：条目 "' + current.displayName +
                        '" 缺少 ' + required[i] + ' 字段'
                    );
                }
            }
            if (!current.签文 || current.签文.trim().length === 0) {
                throw new Error('结果字典格式错误：条目 "' + current.displayName + '" 缺少签文');
            }
            if (!current.推荐功法 || current.推荐功法.length === 0) {
                throw new Error('结果字典格式错误：条目 "' + current.displayName + '" 缺少推荐功法');
            }
            if (!current.画像 || !current.画像.袍色) {
                throw new Error('结果字典格式错误：条目 "' + current.displayName + '" 缺少画像配置');
            }
            if (seenKeys[current.key]) {
                throw new Error(
                    '结果字典格式错误：key "' + current.key +
                    '" 在条目 "' + current.displayName +
                    '" 与 "' + seenKeys[current.key] + '" 重复'
                );
            }
            if (seenNames[current.displayName]) {
                throw new Error(
                    '结果字典格式错误：灵根名 "' + current.displayName +
                    '" 与先前同名条目重复'
                );
            }
            if (seenCodes[current.结果代码]) {
                throw new Error(
                    '结果字典格式错误：结果代码 "' + current.结果代码 +
                    '" 在条目 "' + current.displayName +
                    '" 与 "' + seenCodes[current.结果代码] + '" 重复'
                );
            }
            seenKeys[current.key] = current.displayName;
            seenNames[current.displayName] = true;
            seenCodes[current.结果代码] = current.displayName;
            dict[current.key] = current;
            current = null;
        }

        for (let idx = 0; idx < lines.length; idx++) {
            const line = lines[idx];
            const trimmed = line.trim();

            if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) continue;

            if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
                flush();
                current = {
                    displayName: trimmed.substring(3).trim(),
                    key: null, 品阶: null, 属性: null, 前缀: null, 结果代码: null,
                    签文: '', 资质解读: '', 推荐功法: [], 功法解读: '', 画像: {}
                };
                section = 'meta';
                continue;
            }

            if (current === null) continue;

            if (trimmed.startsWith('### ')) {
                const name = trimmed.substring(4).trim();
                if (name === '签文' || name === '资质解读' || name === '推荐功法' || name === '功法解读' || name === '画像') {
                    section = name;
                } else {
                    section = null;
                }
                continue;
            }

            if (trimmed === '') {
                if ((section === '签文' || section === '资质解读' || section === '功法解读') &&
                    current[section] && !current[section].endsWith('\n\n')) {
                    current[section] += '\n\n';
                }
                continue;
            }

            if (section === 'meta' || section === '画像') {
                const colon = trimmed.indexOf(':');
                if (colon > 0) {
                    const key = trimmed.substring(0, colon).trim();
                    const value = trimmed.substring(colon + 1).trim();
                    if (section === 'meta') {
                        if (['key', '品阶', '属性', '前缀', '结果代码'].indexOf(key) !== -1) {
                            current[key] = value;
                        }
                        continue;
                    }
                    // 画像
                    if (key === '袍色' || key === '符文色') {
                        if (!HEX_COLOR_RE.test(value)) {
                            throw new Error(
                                '结果字典格式错误：条目 "' + current.displayName +
                                '" 画像的 ' + key + ' "' + value + '" 不是合法 hex 颜色'
                            );
                        }
                        current.画像[key] = value;
                    } else if (key === '配饰') {
                        if (!PORTRAIT_ACCESSORIES.has(value)) {
                            throw new Error(
                                '结果字典格式错误：条目 "' + current.displayName +
                                '" 配饰 "' + value + '" 不在白名单'
                            );
                        }
                        current.画像[key] = value;
                    } else if (key === '背景') {
                        if (!PORTRAIT_BACKGROUNDS.has(value)) {
                            throw new Error(
                                '结果字典格式错误：条目 "' + current.displayName +
                                '" 背景 "' + value + '" 不在白名单'
                            );
                        }
                        current.画像[key] = value;
                    } else if (key === 'image') {
                        current.画像.image = value;
                    }
                    continue;
                }
            }

            if (section === '签文' || section === '资质解读' || section === '功法解读') {
                var sep = (current[section] && !current[section].endsWith('\n\n')) ? ' ' : '';
                current[section] += sep + trimmed;
                continue;
            }

            if (section === '推荐功法') {
                if (trimmed.charAt(0) === '-') {
                    var item = trimmed.substring(1).trim();
                    if (item) current.推荐功法.push(item);
                }
                continue;
            }
        }

        flush();

        if (!dict['default_default_default']) {
            throw new Error('结果字典格式错误：缺少 default_default_default 兜底条目');
        }
        return dict;
    }

    /* ================================================================
       Scoring engine
       ================================================================ */

    function score(answers, questions) {
        if (answers.length !== questions.length) {
            throw new Error(
                '测试数据异常：已答 ' + answers.length +
                ' 题，期望 ' + questions.length + ' 题'
            );
        }
        const s = { 金:0, 木:0, 水:0, 火:0, 土:0, 躺平:0, emo:0, 社牛:0 };
        for (let i = 0; i < answers.length; i++) {
            const option = questions[i].options[answers[i]];
            if (!option) continue;
            const deltas = option.deltas || {};
            for (const k in deltas) {
                if (Object.prototype.hasOwnProperty.call(deltas, k)) {
                    s[k] = (s[k] || 0) + deltas[k];
                }
            }
        }
        return s;
    }

    function determinePrefix(scores) {
        const sorted = PERSONA.slice().sort(function (a, b) {
            const d = scores[b] - scores[a];
            if (d !== 0) return d;
            return PERSONA.indexOf(a) - PERSONA.indexOf(b);
        });
        const top = sorted[0];
        return scores[top] >= PREFIX_THRESHOLD ? top : '钝感';
    }

    function classify(scores) {
        const sorted = WUXING.slice().sort(function (a, b) {
            const d = scores[b] - scores[a];
            if (d !== 0) return d;
            return WUXING.indexOf(a) - WUXING.indexOf(b);
        });
        const top    = sorted[0];
        const second = sorted[1];
        const topScore    = scores[top];
        const secondScore = scores[second];
        const wuxingTotal = WUXING.reduce(function (acc, d) { return acc + scores[d]; }, 0);
        const personaMax  = Math.max.apply(null, PERSONA.map(function (p) { return scores[p]; }));
        const prefix      = determinePrefix(scores);

        // Rule 1: yinling (Easter egg)
        if (wuxingTotal <= YINLING_TOTAL_MAX && personaMax >= YINLING_PERSONA_MIN) {
            return { 品阶: 'yinling', 属性: '隐', 前缀: prefix };
        }

        // Rule 2: tianling (single-element dominance)
        if (topScore >= TIANLING_TOP && secondScore <= TIANLING_SECOND_MAX) {
            return { 品阶: 'tianling', 属性: top, 前缀: prefix };
        }

        // Rule 3: bianling (variant pair)
        if (topScore >= BIANLING_TOP && secondScore >= BIANLING_SECOND) {
            const pair = [top, second].sort(function (a, b) {
                return WUXING.indexOf(a) - WUXING.indexOf(b);
            });
            const pairKey = pair.join('_');
            if (BIAN_COMBO[pairKey]) {
                return { 品阶: 'bianling', 属性: BIAN_COMBO[pairKey], 前缀: prefix };
            }
        }

        // Rule 4: zhenling (dual-element mix)
        if (topScore >= ZHENLING_TOP && secondScore >= ZHENLING_SECOND) {
            const pair = [top, second].sort(function (a, b) {
                return WUXING.indexOf(a) - WUXING.indexOf(b);
            });
            return { 品阶: 'zhenling', 属性: pair.join(''), 前缀: prefix };
        }

        // Rule 5: weiling (default catch-all)
        return { 品阶: 'weiling', 属性: '混杂', 前缀: prefix };
    }

    function resolveKey(triple, dict) {
        const candidates = [
            triple.品阶 + '_' + triple.属性 + '_' + triple.前缀,
            triple.品阶 + '_' + triple.属性 + '_default',
            triple.品阶 + '_default_' + triple.前缀,
            triple.品阶 + '_default_default',
            'default_default_default'
        ];
        for (let i = 0; i < candidates.length; i++) {
            if (dict[candidates[i]]) return candidates[i];
        }
        throw new Error('结果字典缺少 default_default_default 兜底条目');
    }

    /* ================================================================
       Portrait — SVG template
       ================================================================ */

    const PORTRAIT_SVG_TEMPLATE =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" role="img" aria-label="灵根人物立像">' +
        '<defs><style>' +
        '.paper{fill:#f4ead3}' +
        '.pao{fill:var(--pao-color,#8b1a1a)}' +
        '.skin{fill:#f8e1c4}' +
        '.hair{fill:#1a1208}' +
        '.ink{fill:#3b2418}' +
        '.fu{stroke:var(--fu-color,#8b1a1a);fill:none;stroke-width:1.5}' +
        '.accent{fill:var(--fu-color,#8b1a1a)}' +
        '.line-soft{stroke:#a38b5c;fill:none;stroke-width:1.2}' +
        'g.acc,g.bg{display:none}' +
        'g.acc.on,g.bg.on{display:inline}' +
        '</style></defs>' +
        '<rect class="paper" width="240" height="320" rx="6"/>' +
        // ========== Backgrounds (hidden by default) ==========
        '<g class="bg" data-bg="waves">' +
            '<path class="line-soft" d="M10 260 Q 40 252 70 260 T 130 260 T 190 260 T 240 260"/>' +
            '<path class="line-soft" d="M10 278 Q 40 270 70 278 T 130 278 T 190 278 T 240 278"/>' +
            '<path class="line-soft" d="M10 296 Q 40 288 70 296 T 130 296 T 190 296 T 240 296"/>' +
        '</g>' +
        '<g class="bg" data-bg="mist-waves">' +
            '<path class="line-soft" stroke-dasharray="4 3" d="M10 260 Q 60 252 120 260 T 240 260"/>' +
            '<path class="line-soft" stroke-dasharray="4 3" d="M10 278 Q 60 270 120 278 T 240 278"/>' +
            '<path class="line-soft" stroke-dasharray="4 3" d="M10 296 Q 60 288 120 296 T 240 296"/>' +
        '</g>' +
        '<g class="bg" data-bg="grass">' +
            '<path class="line-soft" d="M20 310 L 24 282 M 40 310 L 46 278 M 60 310 L 64 284 M 80 310 L 86 278 M 100 310 L 104 282 M 120 310 L 126 278 M 140 310 L 144 284 M 160 310 L 166 278 M 180 310 L 184 282 M 200 310 L 206 278 M 220 310 L 224 284"/>' +
        '</g>' +
        '<g class="bg" data-bg="flames">' +
            '<path fill="#e85c2a" opacity="0.35" d="M20 300 Q 30 255 40 300 Z"/>' +
            '<path fill="#e85c2a" opacity="0.35" d="M60 305 Q 75 248 90 305 Z"/>' +
            '<path fill="#e85c2a" opacity="0.35" d="M150 305 Q 165 248 180 305 Z"/>' +
            '<path fill="#e85c2a" opacity="0.35" d="M200 300 Q 210 255 220 300 Z"/>' +
        '</g>' +
        '<g class="bg" data-bg="rocks">' +
            '<path class="line-soft" d="M15 305 L 50 250 L 85 305 Z"/>' +
            '<path class="line-soft" d="M90 305 L 130 235 L 170 305 Z"/>' +
            '<path class="line-soft" d="M175 305 L 210 260 L 240 305"/>' +
        '</g>' +
        '<g class="bg" data-bg="lightning">' +
            '<path stroke="#a084ff" stroke-width="2" fill="none" d="M30 20 L 55 80 L 40 80 L 65 140 L 48 140 L 70 200"/>' +
            '<path stroke="#a084ff" stroke-width="2" fill="none" d="M200 20 L 218 85 L 200 85 L 222 155"/>' +
        '</g>' +
        '<g class="bg" data-bg="ice-flowers">' +
            '<g stroke="#6fa8dc" fill="none" stroke-width="1.2">' +
                '<g transform="translate(30 40)"><line x1="-6" y1="0" x2="6" y2="0"/><line x1="0" y1="-6" x2="0" y2="6"/><line x1="-4" y1="-4" x2="4" y2="4"/><line x1="-4" y1="4" x2="4" y2="-4"/></g>' +
                '<g transform="translate(200 55)"><line x1="-6" y1="0" x2="6" y2="0"/><line x1="0" y1="-6" x2="0" y2="6"/><line x1="-4" y1="-4" x2="4" y2="4"/><line x1="-4" y1="4" x2="4" y2="-4"/></g>' +
                '<g transform="translate(25 290)"><line x1="-5" y1="0" x2="5" y2="0"/><line x1="0" y1="-5" x2="0" y2="5"/></g>' +
                '<g transform="translate(215 295)"><line x1="-5" y1="0" x2="5" y2="0"/><line x1="0" y1="-5" x2="0" y2="5"/></g>' +
            '</g>' +
        '</g>' +
        '<g class="bg" data-bg="wind">' +
            '<path class="line-soft" d="M10 50 Q 60 42 120 50 T 230 50"/>' +
            '<path class="line-soft" d="M10 70 Q 60 62 120 70 T 230 70"/>' +
            '<path class="line-soft" d="M10 270 Q 60 262 120 270 T 230 270"/>' +
            '<path class="line-soft" d="M10 290 Q 60 282 120 290 T 230 290"/>' +
        '</g>' +
        '<g class="bg" data-bg="dark-clouds">' +
            '<ellipse cx="60" cy="48" rx="40" ry="12" fill="#3b2418" opacity="0.3"/>' +
            '<ellipse cx="180" cy="38" rx="46" ry="14" fill="#3b2418" opacity="0.3"/>' +
            '<ellipse cx="120" cy="62" rx="50" ry="12" fill="#3b2418" opacity="0.25"/>' +
        '</g>' +
        '<g class="bg" data-bg="void">' +
            '<rect width="240" height="320" fill="#0a0a14" opacity="0.18"/>' +
        '</g>' +
        '<g class="bg" data-bg="quilt">' +
            '<rect x="18" y="255" width="204" height="55" fill="#d9c9a4" stroke="#a38b5c"/>' +
            '<path stroke="#a38b5c" fill="none" stroke-dasharray="3 3" d="M30 270 L 210 270 M 30 285 L 210 285 M 30 300 L 210 300"/>' +
        '</g>' +
        '<g class="bg" data-bg="night-rain">' +
            '<g stroke="#5a3d2a" stroke-width="1" opacity="0.5">' +
                '<line x1="20" y1="30" x2="10" y2="60"/><line x1="50" y1="20" x2="40" y2="50"/>' +
                '<line x1="80" y1="40" x2="70" y2="70"/><line x1="110" y1="25" x2="100" y2="55"/>' +
                '<line x1="140" y1="35" x2="130" y2="65"/><line x1="170" y1="20" x2="160" y2="50"/>' +
                '<line x1="200" y1="40" x2="190" y2="70"/><line x1="225" y1="30" x2="215" y2="60"/>' +
            '</g>' +
        '</g>' +
        '<g class="bg" data-bg="crowd">' +
            '<g fill="#a38b5c" opacity="0.55">' +
                '<circle cx="20" cy="298" r="5"/><rect x="15" y="298" width="10" height="15"/>' +
                '<circle cx="45" cy="296" r="5"/><rect x="40" y="296" width="10" height="17"/>' +
                '<circle cx="200" cy="298" r="5"/><rect x="195" y="298" width="10" height="15"/>' +
                '<circle cx="222" cy="296" r="5"/><rect x="217" y="296" width="10" height="17"/>' +
            '</g>' +
        '</g>' +
        '<g class="bg" data-bg="blank"></g>' +
        // ========== Base Taoist figure ==========
        '<ellipse cx="120" cy="42" rx="6" ry="8" class="hair"/>' +
        '<circle cx="120" cy="80" r="28" class="skin"/>' +
        '<path class="hair" d="M92 70 Q 92 55 105 50 Q 120 46 135 50 Q 148 55 148 70 L 148 62 Q 120 50 92 62 Z"/>' +
        '<circle cx="111" cy="80" r="1.8" class="ink"/>' +
        '<circle cx="129" cy="80" r="1.8" class="ink"/>' +
        '<path d="M114 93 Q 120 97 126 93" stroke="#3b2418" stroke-width="1.2" fill="none"/>' +
        '<path class="pao" d="M82 118 Q 120 108 158 118 L 180 300 L 60 300 Z"/>' +
        '<path class="pao" d="M58 140 Q 40 200 55 255 L 72 255 L 80 148 Z"/>' +
        '<path class="pao" d="M182 140 Q 200 200 185 255 L 168 255 L 160 148 Z"/>' +
        '<path class="fu" d="M105 160 L 135 160 M 105 180 L 135 180 M 105 200 L 135 200 M 110 140 L 130 140"/>' +
        // ========== Accessories (hidden by default) ==========
        '<g class="acc" data-acc="sword">' +
            '<rect x="175" y="120" width="4" height="130" class="ink"/>' +
            '<rect x="168" y="116" width="18" height="6" class="ink"/>' +
            '<rect x="176" y="108" width="3" height="10" class="ink"/>' +
        '</g>' +
        '<g class="acc" data-acc="sword-water">' +
            '<rect x="175" y="120" width="4" height="130" fill="#4a7ab8"/>' +
            '<rect x="168" y="116" width="18" height="6" class="ink"/>' +
            '<path stroke="#6fa8dc" fill="none" d="M166 248 Q 175 254 186 248"/>' +
            '<path stroke="#6fa8dc" fill="none" d="M162 260 Q 175 268 188 260"/>' +
        '</g>' +
        '<g class="acc" data-acc="broken-sword">' +
            '<path class="ink" d="M173 250 L 173 155 L 181 145 L 178 165 L 181 250 Z"/>' +
            '<rect x="166" y="246" width="22" height="6" class="ink"/>' +
        '</g>' +
        '<g class="acc" data-acc="staff">' +
            '<rect x="175" y="100" width="3" height="170" class="ink"/>' +
            '<circle cx="176.5" cy="98" r="7" class="accent"/>' +
            '<circle cx="176.5" cy="98" r="3" fill="#f4ead3"/>' +
        '</g>' +
        '<g class="acc" data-acc="gourd">' +
            '<ellipse cx="180" cy="200" rx="10" ry="8" class="accent"/>' +
            '<ellipse cx="180" cy="220" rx="14" ry="13" class="accent"/>' +
            '<rect x="178" y="190" width="4" height="6" class="ink"/>' +
        '</g>' +
        '<g class="acc" data-acc="wine-gourd">' +
            '<ellipse cx="180" cy="200" rx="10" ry="8" fill="#7a5233"/>' +
            '<ellipse cx="180" cy="220" rx="14" ry="13" fill="#7a5233"/>' +
            '<circle cx="176" cy="215" r="1.5" fill="#f4ead3"/>' +
            '<circle cx="184" cy="218" r="1.5" fill="#f4ead3"/>' +
            '<rect x="178" y="190" width="4" height="6" class="ink"/>' +
        '</g>' +
        '<g class="acc" data-acc="cauldron">' +
            '<path d="M158 225 L 202 225 L 196 255 L 164 255 Z" fill="#5a3d2a"/>' +
            '<ellipse cx="180" cy="225" rx="22" ry="4" fill="#3b2418"/>' +
            '<path stroke="#e85c2a" stroke-width="1.5" fill="none" d="M170 220 Q 175 208 180 220 M 184 220 Q 189 208 194 220"/>' +
        '</g>' +
        '<g class="acc" data-acc="seal">' +
            '<rect x="165" y="200" width="28" height="28" fill="#8b1a1a"/>' +
            '<rect x="169" y="204" width="20" height="20" fill="none" stroke="#f4ead3" stroke-width="1.5"/>' +
            '<text x="179" y="220" font-size="12" fill="#f4ead3" text-anchor="middle" font-family="serif" font-weight="bold">灵</text>' +
        '</g>' +
        '<g class="acc" data-acc="fan">' +
            '<path class="accent" d="M165 170 L 205 130 L 205 205 Z" opacity="0.9"/>' +
            '<path stroke="#3b2418" stroke-width="0.8" fill="none" d="M170 170 L 200 138 M 175 170 L 205 150 M 180 170 L 205 165 M 180 180 L 205 185"/>' +
        '</g>' +
        '<g class="acc" data-acc="banner">' +
            '<rect x="175" y="100" width="2" height="170" class="ink"/>' +
            '<path class="accent" d="M177 100 L 222 104 L 222 150 L 177 146 Z"/>' +
            '<text x="199" y="131" font-size="14" fill="#f4ead3" text-anchor="middle" font-family="serif" font-weight="bold">仙</text>' +
        '</g>' +
        '<g class="acc" data-acc="pillow">' +
            '<rect x="152" y="222" width="44" height="22" rx="5" fill="#efe6c9" stroke="#a38b5c"/>' +
            '<path stroke="#a38b5c" fill="none" d="M158 228 Q 175 222 192 228"/>' +
        '</g>' +
        '<g class="acc" data-acc="wooden-fish">' +
            '<ellipse cx="180" cy="220" rx="18" ry="13" fill="#a0724a"/>' +
            '<path d="M168 213 Q 180 207 192 213" fill="none" stroke="#3b2418" stroke-width="2"/>' +
            '<rect x="178" y="198" width="4" height="9" class="ink"/>' +
        '</g>' +
        '<g class="acc" data-acc="nothing"></g>' +
        '</svg>';

    function renderPortrait(config) {
        if (!config) return '';
        if (config.image) {
            var img = document.createElement('img');
            img.src = config.image;
            img.alt = '灵根人物';
            img.width = 240;
            img.height = 320;
            return img;
        }
        const required = ['袍色', '配饰', '背景', '符文色'];
        for (let i = 0; i < required.length; i++) {
            if (!config[required[i]]) {
                throw new Error('画像配置缺失字段: ' + required[i]);
            }
        }
        if (!HEX_COLOR_RE.test(config.袍色)) {
            throw new Error('袍色不是合法 hex 颜色: ' + config.袍色);
        }
        if (!HEX_COLOR_RE.test(config.符文色)) {
            throw new Error('符文色不是合法 hex 颜色: ' + config.符文色);
        }
        if (!PORTRAIT_ACCESSORIES.has(config.配饰)) {
            throw new Error('配饰值不在枚举白名单: ' + config.配饰);
        }
        if (!PORTRAIT_BACKGROUNDS.has(config.背景)) {
            throw new Error('背景值不在枚举白名单: ' + config.背景);
        }

        let svg = PORTRAIT_SVG_TEMPLATE;
        svg = svg.replace(
            '<svg xmlns',
            '<svg style="--pao-color: ' + config.袍色 + '; --fu-color: ' + config.符文色 + ';" xmlns'
        );
        svg = svg.replace(
            '<g class="bg" data-bg="' + config.背景 + '">',
            '<g class="bg on" data-bg="' + config.背景 + '">'
        );
        svg = svg.replace(
            '<g class="acc" data-acc="' + config.配饰 + '">',
            '<g class="acc on" data-acc="' + config.配饰 + '">'
        );
        return svg;
    }

    /* ================================================================
       State + router
       ================================================================ */

    const state = {
        questions: [],
        resultsDict: {},
        answers: [],
        cursor: 0,
        classification: null
    };

    const router = {
        go: function (id) {
            const sections = document.querySelectorAll('.section');
            sections.forEach(function (s) { s.classList.remove('active'); });
            const target = document.getElementById(id);
            if (target) target.classList.add('active');
        }
    };

    /* ================================================================
       Renderers
       ================================================================ */

    function renderHome() {
        const home = document.getElementById('home');
        if (!home) return;
        home.innerHTML =
            '<div class="home-hero">' +
                '<h1>SBIT 测试，但修仙版</h1>' +
                '<p class="subtitle">测测你的灵根和资质，能否走上修仙大道？<br>16 题测出你在修仙界的品阶 · 数据完全本地计算</p>' +
            '</div>' +
            '<button class="btn btn-primary" id="start-btn" type="button">开卷测灵根</button>' +
            '<div class="home-footer">华科开放原子开源俱乐部 出品</div>';
        const btn = document.getElementById('start-btn');
        if (btn) btn.addEventListener('click', startQuiz);
    }

    function startQuiz() {
        state.answers = [];
        state.cursor = 0;
        state.classification = null;
        router.go('quiz');
        renderQuiz();
    }

    function renderQuiz() {
        const quiz = document.getElementById('quiz');
        if (!quiz) return;
        const q = state.questions[state.cursor];
        if (!q) return;
        const total = state.questions.length;
        const progress = Math.round((state.cursor / total) * 100);
        const fallbackLabels = ['甲', '乙', '丙'];

        let optionsHtml = '';
        for (let i = 0; i < q.options.length; i++) {
            const o = q.options[i];
            const label = o.label || fallbackLabels[i] || String(i + 1);
            optionsHtml +=
                '<button class="option" type="button" data-index="' + i + '">' +
                    '<span class="option-label">' + escapeHtml(label) + '</span>' +
                    '<span class="option-text">' + escapeHtml(o.text) + '</span>' +
                '</button>';
        }

        quiz.innerHTML =
            '<div class="quiz-progress">' +
                '<span class="label">第 ' + (state.cursor + 1) + ' 问 / 共 ' + total + '</span>' +
                '<div class="progress-bar"><i style="width: ' + progress + '%"></i></div>' +
            '</div>' +
            '<p class="quiz-prompt">' + escapeHtml(q.prompt) + '</p>' +
            '<div class="options" role="radiogroup">' + optionsHtml + '</div>';

        const options = quiz.querySelectorAll('.option');
        options.forEach(function (opt) {
            opt.addEventListener('click', function () {
                handleOption(parseInt(opt.getAttribute('data-index'), 10));
            });
        });
        if (options[0]) options[0].focus();
    }

    function handleOption(choice) {
        state.answers[state.cursor] = choice;
        state.cursor += 1;
        if (state.cursor >= state.questions.length) {
            finalizeQuiz();
        } else {
            renderQuiz();
        }
    }

    function handleKeydown(e) {
        const quizSection = document.getElementById('quiz');
        if (!quizSection || !quizSection.classList.contains('active')) return;
        if (e.key === '1' || e.key === '2' || e.key === '3') {
            const idx = parseInt(e.key, 10) - 1;
            const btn = quizSection.querySelector('.option[data-index="' + idx + '"]');
            if (btn) {
                e.preventDefault();
                btn.click();
            }
        } else if (e.key === 'Enter') {
            const focused = document.activeElement;
            if (focused && focused.classList && focused.classList.contains('option')) {
                e.preventDefault();
                focused.click();
            }
        }
        // ArrowLeft deliberately ignored: back-navigation is a spec non-goal (AC-14).
    }

    function finalizeQuiz() {
        try {
            const scores = score(state.answers, state.questions);
            const triple = classify(scores);
            const key = resolveKey(triple, state.resultsDict);
            state.classification = {
                scores: scores,
                triple: triple,
                key: key,
                result: state.resultsDict[key]
            };
            router.go('result');
            renderResult();
        } catch (e) {
            renderError(e.message);
            router.go('error');
        }
    }

    function renderResult() {
        const result = document.getElementById('result');
        if (!result) return;
        const c = state.classification;
        if (!c || !c.result) return;
        const r = c.result;
        const prefix = c.triple.前缀;
        const sealMap = { '躺平': '躺', 'emo': 'emo', '社牛': '牛', '钝感': '钝' };
        const sealChar = sealMap[prefix] || '?';
        const portraitOutput = renderPortrait(r.画像);
        // portraitOutput: string (SVG HTML) or HTMLElement (img node)
        const portraitIsNode = portraitOutput && typeof portraitOutput !== 'string';

        let wuxingBars = '';
        for (let i = 0; i < WUXING.length; i++) {
            const d = WUXING[i];
            const s = c.scores[d] || 0;
            // DEC-6 A: clamped max(0, min(score, 7)) / 7 * 100%
            const w = Math.max(0, Math.min(s, 7)) / 7 * 100;
            wuxingBars +=
                '<div class="wuxing-row">' +
                    '<span class="wuxing-name">' + d + '</span>' +
                    '<div class="wuxing-bar"><i style="width: ' + w.toFixed(1) + '%"></i></div>' +
                    '<span class="wuxing-score">' + s + '</span>' +
                '</div>';
        }

        const fortuneHtml = escapeHtml(r.签文)
            .split(/\n\n+/)
            .map(function (p) { return '<p class="fortune-text">' + p + '</p>'; })
            .join('');

        let methodsHtml = '';
        for (let i = 0; i < r.推荐功法.length; i++) {
            methodsHtml += '<li>' + escapeHtml(r.推荐功法[i]) + '</li>';
        }

        result.innerHTML =
            '<div class="portrait-wrap" id="portrait-container"></div>' +
            '<div class="result-heading">' +
                '<h1>' + escapeHtml(r.displayName) +
                    '<span class="persona-seal" title="人设倾向: ' + escapeHtml(prefix) + '" ' +
                    'aria-label="人设印章 ' + escapeHtml(prefix) + '">' + escapeHtml(sealChar) + '</span>' +
                '</h1>' +
                '<p class="result-subtitle">品阶 · ' + escapeHtml(r.品阶) + '</p>' +
            '</div>' +
            '<div class="result-row">' +
                '<div class="result-section">' +
                    '<span class="label">签文</span>' +
                    fortuneHtml +
                '</div>' +
                '<div class="result-section">' +
                    '<span class="label">五行</span>' +
                    '<div class="wuxing-bars">' + wuxingBars + '</div>' +
                '</div>' +
            '</div>' +
            (r.资质解读 ? '<div class="result-section"><span class="label">资质解读</span>' +
                escapeHtml(r.资质解读).split(/\n\n+/).map(function(p){return '<p class="fortune-text">' + p + '</p>';}).join('') +
            '</div>' : '') +
            '<div class="result-section">' +
                '<span class="label">推荐功法</span>' +
                '<ul class="methods-list">' + methodsHtml + '</ul>' +
            '</div>' +
            (r.功法解读 ? '<div class="result-section"><span class="label">功法解读</span>' +
                escapeHtml(r.功法解读).split(/\n\n+/).map(function(p){return '<p class="fortune-text">' + p + '</p>';}).join('') +
            '</div>' : '') +
            '<button class="result-code" id="result-code" type="button">' + escapeHtml(r.结果代码) + '</button>' +
            '<div class="result-actions">' +
                '<button class="btn" id="retry-btn" type="button">再测一次</button>' +
                '<button class="btn btn-primary" id="screenshot-btn" type="button">截图发给好友 →</button>' +
            '</div>';

        // Insert portrait: DOM node (img) or HTML string (SVG)
        var portraitContainer = document.getElementById('portrait-container');
        if (portraitContainer) {
            if (portraitIsNode) {
                portraitContainer.appendChild(portraitOutput);
            } else if (portraitOutput) {
                portraitContainer.innerHTML = portraitOutput;
            }
        }

        var codeBtn = document.getElementById('result-code');
        if (codeBtn) codeBtn.addEventListener('click', copyResultCode);
        var retryBtn = document.getElementById('retry-btn');
        if (retryBtn) retryBtn.addEventListener('click', restart);
        var shotBtn = document.getElementById('screenshot-btn');
        if (shotBtn) shotBtn.addEventListener('click', showScreenshotHint);
    }

    function copyResultCode() {
        const c = state.classification;
        if (!c || !c.result) return;
        const text = c.result.结果代码 + ' | ' + c.result.displayName;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                showToast('已复制，快去炫耀');
            }).catch(function () {
                fallbackCopy(text);
            });
            return;
        }
        fallbackCopy(text);
    }

    function fallbackCopy(text) {
        const el = document.getElementById('result-code');
        if (el && window.getSelection && document.createRange) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
        showToast('请手动选中并复制');
    }

    function showScreenshotHint() {
        const ua = (navigator.userAgent || '').toLowerCase();
        let hint;
        if (/iphone|ipad|ipod/.test(ua))      hint = 'iPhone · 侧键 + 音量上 截图';
        else if (/android/.test(ua))          hint = 'Android · 电源 + 音量下 截图';
        else if (/macintosh|mac os x/.test(ua)) hint = 'macOS · Cmd + Shift + 4 截图';
        else if (/windows/.test(ua))          hint = 'Windows · Win + Shift + S 截图';
        else                                  hint = '请用系统截图快捷键截图';
        showToast(hint);
    }

    function showToast(msg) {
        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        // Force reflow so transition replays if a prior toast is still fading.
        void toast.offsetWidth;
        toast.classList.add('show');
        if (toast._timer) clearTimeout(toast._timer);
        toast._timer = setTimeout(function () {
            toast.classList.remove('show');
        }, 2500);
    }

    function restart() {
        state.answers = [];
        state.cursor = 0;
        state.classification = null;
        router.go('home');
        renderHome();
    }

    function renderError(msg) {
        const err = document.getElementById('error');
        if (!err) return;
        err.innerHTML =
            '<h2>签文解读失败</h2>' +
            '<div class="error-msg"></div>' +
            '<p class="subtitle">宗门弟子请检查卷轴 —— 若是直接双击打开的 index.html，' +
            '请改用 <code>python3 -m http.server</code> 启动本地服务器。</p>' +
            '<button class="btn" id="err-retry-btn" type="button">重试</button>';
        const msgEl = err.querySelector('.error-msg');
        if (msgEl) msgEl.textContent = msg;
        const retryBtn = document.getElementById('err-retry-btn');
        if (retryBtn) retryBtn.addEventListener('click', function () { location.reload(); });
    }

    /* ================================================================
       Bootstrap
       ================================================================ */

    async function main() {
        try {
            document.addEventListener('keydown', handleKeydown);
            const loaded = await Promise.all([
                loadMarkdown('data/questions.md'),
                loadMarkdown('data/results.md')
            ]);
            state.questions   = parseQuestions(loaded[0]);
            state.resultsDict = parseResults(loaded[1]);
            if (state.questions.length === 0) {
                throw new Error('题库为空：data/questions.md 中未找到任何题目');
            }
            router.go('home');
            renderHome();
        } catch (e) {
            renderError(e.message);
            router.go('error');
        }
    }

    /* ================================================================
       Namespace export + auto-bootstrap guard
       ================================================================ */

    LingenTest.parseQuestions       = parseQuestions;
    LingenTest.parseResults         = parseResults;
    LingenTest.score                = score;
    LingenTest.classify             = classify;
    LingenTest.determinePrefix      = determinePrefix;
    LingenTest.resolveKey           = resolveKey;
    LingenTest.renderPortrait       = renderPortrait;
    LingenTest.renderHome           = renderHome;
    LingenTest.renderQuiz           = renderQuiz;
    LingenTest.renderResult         = renderResult;
    LingenTest.renderError          = renderError;
    LingenTest.handleKeydown        = handleKeydown;
    LingenTest.showScreenshotHint   = showScreenshotHint;
    LingenTest.main                 = main;
    LingenTest.state                = state;
    LingenTest.router               = router;
    LingenTest.loadMarkdown         = loadMarkdown;
    LingenTest.PORTRAIT_ACCESSORIES = PORTRAIT_ACCESSORIES;
    LingenTest.PORTRAIT_BACKGROUNDS = PORTRAIT_BACKGROUNDS;
    LingenTest.WUXING               = WUXING;
    LingenTest.PERSONA              = PERSONA;

    global.LingenTest = LingenTest;

    // Production auto-bootstrap; test.html sets LingenTest_SKIP_BOOTSTRAP = true first.
    if (!global.LingenTest_SKIP_BOOTSTRAP && typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', main);
        } else {
            main();
        }
    }

})(typeof window !== 'undefined' ? window : this);
