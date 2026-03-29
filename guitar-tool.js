class PhonogramTablature extends HTMLElement {
    constructor() {
        super();
        // Create Shadow DOM to prevent Wix CSS interference
        this.attachShadow({ mode: 'open' });

        // App State
        this.tuning = ["E4", "B3", "G3", "D3", "A2", "E2"];
        this.currentFrets = [-1, -1, -1, -1, -1, -1];
        this.progressionData = [];
        this.isUserEditingChord = false;
        this.titleHasBeenEdited = false;
        this.lastUserTitle = "SONG TITLE";

        // Clipboard Memory
        this.clipboardChordOnly = null;
        this.clipboardStrumOnly = null;

        // UI State
        this.selectedSlotIndex = null;
        this.activeBrush = 'd';
        this.tempStrumData = { pattern: [], resolution: 4 };
        this.isPaintingStrums = false;
        this.currentlySelectedChordName = "";

        // Cloud Memory Data
        this.cloudBankData = [];
        this.previousBpm = "";
        this.tooltipTimeout = null;

        // Sorting State
        this.currentSortCol = 'lastModified';
        this.currentSortAsc = false;
        this.selectedProgressionIds = new Set();
        this.pendingDeleteId = null;

        // Supabase DB
        this.supabaseClient = null;
    }

    async connectedCallback() {
        this.renderTemplate();
        await this.loadDependencies();
        this.initApp();
        this.attachDelegatedEvents();
    }

    // ========================================== //
    // --- DEPENDENCY LOADER ---                  //
    // ========================================== //
    async loadDependencies() {
        const scripts = [
            "https://cdn.jsdelivr.net/npm/tonal/browser/tonal.min.js",
            "https://cdn.jsdelivr.net/npm/vexflow@4.2.2/build/cjs/vexflow.js",
            "https://unpkg.com/vexchords@1.2.0/dist/vexchords.dev.js",
            "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js",
            "https://unpkg.com/@supabase/supabase-js@2"
        ];

        // Google Fonts (injected to Light DOM so Shadow DOM can inherit)
        if (!document.getElementById('phonogram-fonts')) {
            const fonts = document.createElement('style');
            fonts.id = 'phonogram-fonts';
            fonts.innerHTML = `
                @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap');
                @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&display=swap');
            `;
            document.head.appendChild(fonts);
        }

        for (const src of scripts) {
            await new Promise((resolve) => {
                if (document.querySelector(`script[src="${src}"]`)) {
                    resolve();
                    return;
                }
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }
    }

    // ========================================== //
    // --- TEMPLATE & STYLING ---                 //
    // ========================================== //
    renderTemplate() {
        this.shadowRoot.innerHTML = `
        <style>
            /* --- GLOBAL BASE --- */
            * { box-sizing: border-box; } 
            :host { display: block; font-family: 'Outfit', sans-serif; background: #121212; color: white; padding: 20px; margin: 0; height: fit-content; width: 100%; }
            .app-card { background: #1e1e1e; padding: 30px; border-radius: 12px; max-width: 1100px; margin: auto; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5); position: relative; }
            h1 { font-family: 'Outfit', sans-serif; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; font-size: 1.1rem; color: #fff; margin-top: 0; }
            .sub-header { color: #888; font-size: 1rem; margin-bottom: 10px; }
            .cormorant-garamond-slanted { font-family: "Cormorant Garamond", serif; font-optical-sizing: auto; font-weight: 700; font-style: italic; }

            /* --- STANDARDIZED BUTTON SYSTEM --- */
            .btn { font-family: 'Outfit', sans-serif; letter-spacing: 1px; padding: 15px 20px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; text-transform: uppercase; text-align: center; transition: background 0.2s, opacity 0.3s; display: inline-flex; align-items: center; justify-content: center; color: white; }
            .btn:disabled { opacity: 0.4; cursor: not-allowed; background: #555 !important; }
            .btn-primary { background: #db3069; }
            .btn-primary:hover:not(:disabled) { background: #ff4d8d; }
            .btn-secondary { background: #444; }
            .btn-secondary:hover:not(:disabled) { background: #555; }
            .btn-secondary.selected { background: #555; outline: 1px solid #28a745; outline-offset: -1px; }
            .btn-success { background: #28a745; }
            .btn-success:hover:not(:disabled) { background: #218838; }
            .btn-sm { padding: 8px 15px; font-size: 0.8rem; }
            .btn-wide { min-width: 170px; }
            .btn-group { display: flex; gap: 10px; }
            .btn-group .btn { flex: 1; }
            
            /* --- FRETBOARD --- */
            .fretboard-layout::-webkit-scrollbar { height: 20px; }
            .fretboard-layout::-webkit-scrollbar-track { background: transparent; }
            .fretboard-layout::-webkit-scrollbar-thumb { background: #444; border-radius: 16px; border: 6px solid #121212; background-clip: padding-box; }
            .fretboard-layout::-webkit-scrollbar-thumb:hover { background: #555; }
            .fretboard-layout { display: flex; flex-direction: column; margin-bottom: 30px; margin-top: 10px; background: #121212; padding: 20px; border-radius: 8px; border: 1px solid #333; overflow-x: auto; scroll-behavior: smooth;}
            .fret-header-row { display: grid; grid-template-columns: 60px repeat(24, 180px); margin-left: 40px; margin-bottom: 10px; }
            .fret-number { display: flex; align-items: center; justify-content: center; color: #666; font-weight: 800; font-size: 0.75rem; }
            .fretboard-core-wrap { display: flex; }
            .string-labels-col { width: 40px; display: flex; flex-direction: column; }
            .string-label { height: 50px; display: flex; align-items: center; justify-content: center; color: #666; font-weight: 800; font-size: 1rem; }
            .fretboard-interactive-area { flex: 1; position: relative; }
            .visual-grid { position: absolute; top: 25px; bottom: 25px; left: 60px; right: 0; pointer-events: none; }
            .v-string { position: absolute; left: 0; right: 0; height: 1px; background: #444; }
            .v-fret { position: absolute; top: 0; bottom: 0; width: 1px; background: #444; }
            .v-nut { position: absolute; top: 0; bottom: 0; left: 0; width: 5px; background: #d4d4d4; transform: translateX(-2.5px); border-radius: 1px; z-index: 5; }
            .interaction-grid { display: grid; grid-template-columns: 60px repeat(24, 180px); grid-template-rows: repeat(6, 50px); }
            .click-zone { display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; position: relative; }
            .note-visual { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1rem; pointer-events: none; z-index: 20; position: relative; }
            .open-dot { border: 2px solid white; color: white; background: #121212; }
            .muted-x { color: #db3069; font-family: 'Arial Black', sans-serif; font-size: 1.4rem; }
            .fretted-dot { background: #db3069; border: 1px solid white; color: white; box-shadow: 0 0 12px rgba(219, 48, 105, 0.4); }
            
            /* --- CONTROLS --- */
            .controls { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 30px; background: #1e1e1e; padding: 25px; border-radius: 8px; border: 1px solid #333; align-items: center; }
            .chord-name-container { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
            #chordNameDisplay { font-family: 'Outfit', sans-serif; margin: 0; font-size: 2.2rem; font-weight: 800; color: #fff; outline: none; border-bottom: 2px dashed transparent; transition: border-bottom 0.3s; }
            #chordNameDisplay[contenteditable="true"] { border-bottom: 2px dashed #db3069; }
            .edit-icon { fill: #666; cursor: pointer; transition: fill 0.3s; }
            .edit-icon:hover { fill: #db3069; }
            #notesDisplay { color: #db3069; font-family: monospace; font-size: 1.1rem; letter-spacing: 2px; }

            /* --- LEAD SHEET --- */
            #lead-sheet { background: white; border-radius: 8px; padding: 40px; color: black; margin-top: 30px; min-height: 450px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); width: 100%; position: relative; cursor: default; }
            .title-container { border-bottom: 2px solid black; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; padding-bottom: 5px; flex-wrap: wrap; }
            #songTitleDisplay { font-weight: 900; font-size: 0.9rem; letter-spacing: 1px; text-transform: uppercase; outline: none; min-width: 50px; }
            #songTitleDisplay[contenteditable="true"] { border-bottom: 1px dashed #db3069; background: #fffceb; }
            #keyDisplay { font-family: "Cormorant Garamond", serif; font-weight: 700; font-size: 1rem; color: #444; font-style: italic; margin-bottom: 20px; pointer-events: none; }
            #bpmDisplay { font-family: "Cormorant Garamond", serif; font-weight: 700; font-size: 1rem; color: #444; font-style: italic; margin-bottom: 20px; display: flex; align-items: baseline; }
            #bpm-value { outline: none; -webkit-tap-highlight-color: transparent; font-size: 1.4rem; line-height: 1.4rem; }
            #bpm-icon { transform: scaleX(-1); }
            
            /* --- GRID & SELECTION --- */
            .sheet-container { display: block; width: 100%; position: relative; }
            #session-grid { display: flex; width: 100%; flex-wrap: nowrap; gap: 0; }
            .progression-slot { position: relative; width: 25%; flex: 0 0 25%; display: flex; flex-direction: column; align-items: center; transition: all 0.2s; border: 2px solid transparent; border-radius: 4px; background: white; }
            .progression-slot:hover { background: #f7f7f7; }
            .progression-slot.selected { border-color: #db3069; background: #fffafa; box-shadow: inset 0 0 10px rgba(219, 48, 105, 0.05); }
            .slot-actions { position: absolute; display: flex; opacity: 0; transition: opacity 0.2s; z-index: 100; }
            .progression-slot:hover .slot-actions { opacity: 1; }
            .action-icon-btn { background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; color: #999; transition: color 0.2s; }
            .action-icon-btn:hover { color: #db3069; }
            .action-icon-btn.disabled { opacity: 0.2; cursor: not-allowed; pointer-events: none; }
            #btn-add-bar { position: absolute; display: flex; align-items: center; justify-content: center; background: none; border: none; padding: 0; cursor: pointer; z-index: 200; top: 135px; transform: translateX(-50%); transition: all 0.2s; color: #999; }
            #btn-add-bar:hover { color: #db3069; transform: translateX(-50%) scale(1.1); }
            .chord-label { font-weight: 800; font-size: 1.2rem; margin-top: 10px; height: 30px; min-height: 30px; text-align: center; pointer-events: none; }
            .diag-wrapper { height: 140px; min-height: 140px; width: 100%; display: flex; justify-content: center; position: relative; pointer-events: none; } 
            .tab-wrapper { width: 100%; pointer-events: none; }
            .action-footer { display: flex; justify-content: flex-end; margin-top: 15px; gap: 10px; }

            /* --- STRUM ARCHITECT MODAL --- */
            #strum-modal { position: absolute; width: 380px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; box-shadow: 0 15px 40px rgba(0,0,0,0.8); z-index: 1000; display: none; flex-direction: column; gap: 15px; padding: 15px; color: white; }
            #strum-modal.active { display: flex; }
            .modal-drag-handle { cursor: move; background: #222; margin: -15px -15px 0 -15px; padding: 10px 15px; border-bottom: 1px solid #333; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center; }
            .modal-drag-handle h3 { margin: 0; font-size: 0.8rem; letter-spacing: 1px; color: #db3069; }
            .close-modal-btn { background: none; border: none; color: #888; cursor: pointer; transition: color 0.2s; padding: 0; display: flex;}
            .close-modal-btn:hover { color: #fff; }
            .strum-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;}
            .tool-btn { background: #333; border: 1px solid #444; color: #fff; width: 34px; height: 34px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold; transition: all 0.2s; }
            .tool-btn:hover { background: #444; }
            .tool-btn.active { background: #db3069; border-color: #ff4d8d; }
            .res-dropdown { background: #333; color: white; border: 1px solid #444; padding: 6px; border-radius: 4px; font-size: 0.8rem; margin-left: auto; cursor: pointer; outline: none; }
            .strum-grid-container { display: flex; flex-wrap: nowrap; width: 100%; background: #121212; border: 1px solid #333; border-radius: 4px; overflow: hidden; height: 60px; touch-action: none; }
            .strum-cell { flex: 1 1 0; min-width: 0; border-right: 1px solid #222; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.1s; font-size: 1rem; font-weight: bold; color: #555; user-select: none; }
            .strum-cell:last-child { border-right: none; }
            .strum-cell:hover { background: #1e1e1e; }
            .strum-cell.state-d { color: #fff; background: rgba(255,255,255,0.05); } 
            .strum-cell.state-u { color: #4facfe; background: rgba(79, 172, 254, 0.05); } 
            .strum-cell.state-m { color: #db3069; background: rgba(219, 48, 105, 0.05); } 
            .strum-footer { display: flex; justify-content: flex-end; margin-top: 5px; }

            /* --- SNACKBAR & ALERTS --- */
            #snackbar { visibility: hidden; min-width: 320px; background-color: #ffffff; color: #121212; border-radius: 8px; padding: 16px 24px; position: fixed; z-index: 5000; left: 50%; bottom: 30px; transform: translateX(-50%); font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; font-size: 0.75rem; box-shadow: 0 15px 35px rgba(0,0,0,0.4); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; transition: visibility 0s, opacity 0.3s ease-in-out; opacity: 0; }
            #snackbar.warning { border-left: 6px solid #db3069; }
            .warn-icon { display: none; width: 20px; height: 20px; background: #db3069; color: white; border-radius: 50%; align-items: center; justify-content: center; font-size: 14px; font-weight: 900; }
            #snackbar.warning .icon-warn { display: flex; background: #db3069; }
            #snackbar.success { border-left: 6px solid #28a745; }
            #snackbar.success .icon-success { display: flex; background: #28a745; }
            .sb-icon { width: 22px; height: 22px; border-radius: 50%; display: none; align-items: center; justify-content: center; font-size: 14px; font-weight: 900; color: white; flex-shrink: 0; }
            #snackbar.show { visibility: visible; opacity: 1; animation: fadein-bottom 0.4s, fadeout-bottom 0.4s 2.6s; }
            @keyframes fadein-bottom { from {bottom: 0; opacity: 0;} to {bottom: 30px; opacity: 1;} }
            @keyframes fadeout-bottom { from {bottom: 30px; opacity: 1;} to {bottom: 0; opacity: 0;} }

            /* Chord Alternates */
            .alt-btn { min-width: 80px; padding: 8px 12px; background: #222; color: #555; border: 1px solid #333; border-radius: 4px; font-family: 'Outfit', sans-serif; font-size: 14px; cursor: pointer; transition: all 0.2s ease; }
            .alt-btn.active { background: #ffffff10; color: white; cursor: pointer; }
            .alt-btn.active:hover { background: #ffffff20; }
            .alt-btn.selected { background: #ffffff00; color: #fff; }

            /* Progression Bank List View */
            .bank-list-container { width: 100%; margin-top: 20px; border: 1px solid #333; border-radius: 4px; overflow: hidden; background: #1a1a1a; }
            .bank-header, .bank-row { display: grid; grid-template-columns: 40px 2fr 1fr 1fr 1.5fr; gap: 10px; align-items: center; }
            .bank-header { background: #252525; padding: 12px 20px; border-bottom: 1px solid #333; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #888; }
            .bank-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .bank-btn { display: flex; gap: 10px; }
            .sort-header { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; transition: color 0.2s; }
            .sort-header:hover { color: #fff; }
            .sort-arrow-wrap { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
            .sort-arrow { transition: transform 0.2s, opacity 0.2s; opacity: 0; fill: currentColor; }
            .sort-header:hover .sort-arrow.inactive { opacity: 0.4; }
            .sort-header.active .sort-arrow { opacity: 1; color: #db3069; }
            .sort-arrow.desc { transform: rotate(180deg); }
            .bank-row { padding: 12px 20px; border-bottom: 1px solid #222; cursor: pointer; transition: background 0.2s; position: relative; }
            .bank-row:last-child { border-bottom: none; }
            .bank-row:hover { background: #2a2a2a; }
            .bank-row .col-name { color: #fff; font-weight: 500; font-size: 0.9rem; }
            .bank-row .col-key { color: #db3069; font-family: monospace; font-size: 0.85rem; font-weight: 600; }
            .bank-row .col-bpm { color: #888; font-size: 0.85rem; font-weight: 600; font-family: monospace; }
            .bank-row .col-modified { color: #666; font-size: 0.8rem; font-family: monospace; }
            .col-check { display: flex; align-items: center; justify-content: center; }

            /* Inline Edit UI */
            .title-edit-wrapper { display: flex; align-items: center; gap: 10px; width: 100%; }
            .bank-title-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;}
            .inline-edit-btn { background: none; border: none; padding: 0; margin-top: 2px; color: #666; cursor: pointer; opacity: 0; transition: color 0.2s, opacity 0.2s; display: flex; align-items: center; justify-content: center; }
            .bank-row:hover .inline-edit-btn { opacity: 1; }
            .inline-edit-btn:hover { color: #db3069; }
            .col-name-input { background: #111; color: #fff; border: 1px solid #db3069; padding: 4px 8px; outline: none; font-family: 'Outfit', sans-serif; font-size: 0.9rem; width: 90%; border-radius: 4px; box-shadow: inset 0 0 5px rgba(0,0,0,0.5); text-transform: uppercase;}

            /* Bank Row Delete Button */
            .row-delete-btn { position: absolute; right: 20px; top: 50%; transform: translateY(-50%); opacity: 0; transition: color 0.2s, opacity 0.2s; background: none; color: #999; border: none; padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; }
            .bank-row:hover .row-delete-btn { opacity: 1; }
            .row-delete-btn:hover { color: #db3069; }

            /* Deletion Modal Styles */
            .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 9999; }
            .confirm-card { background: #1e1e1e; border: 1px solid #333; padding: 30px; border-radius: 12px; text-align: center; max-width: 400px; }
            .confirm-card h3 { margin: 0 0 10px; text-transform: uppercase; font-size: 1rem; color: #fff; }
            .confirm-card p { color: #888; font-size: 0.9rem; margin-bottom: 25px; }
            .confirm-actions { display: flex; gap: 10px; justify-content: center; }

            /* --- PDF EXPORT MODAL & STAGING --- */
            #pdf-preview-modal { display: none; position: fixed; z-index: 3000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.9); backdrop-filter: blur(5px); scrollbar-width: thin; scrollbar-color: #777 transparent; }
            .modal-content { background-color: #f0f0f0; margin: 2% auto; padding: 0; width: 1100px; height: 90vh; border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            .modal-header { background: #1e1e1e; padding: 15px 25px; display: flex; justify-content: space-between; align-items: center; border-radius: 8px 8px 0 0; }
            .preview-body { flex-grow: 1; overflow-y: auto; padding: 20px; background: #555; }
            .pdf-page-preview { background: white; width: 700px; margin: 0 auto 30px auto; box-shadow: 0 5px 15px rgba(0,0,0,0.3); padding: 50px; color: black; min-height: 900px; }
            .pdf-page-break { page-break-after: always; padding: 40px; }
            
            :host(.printing-mode) #lead-sheet { background: white !important; color: black !important; }
            :host(.printing-mode) .chord-slot { background: white !important; border-color: #eee !important; }
            :host(.printing-mode) .sheet-container { background: white !important; }

            #pdf-pages-staging { margin-top: 0 !important; pointer-events: none; }
            .html2pdf__page-break { pointer-events: auto; }
            #pdf-pages-staging .chord-slot { background: white !important; border: none !important; color: black !important; box-shadow: none !important; transform: none !important; }
            #pdf-pages-staging svg { filter: invert(0) !important; }
            #pdf-pages-staging .pdf-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0 !important; width: 100%; background: white; }
            #pdf-pages-staging .pdf-title { font-size: 1.5rem; font-weight: 800; color: black; margin: 0; }
            #pdf-pages-staging .pdf-key { font-size: 0.9rem; font-weight: 800; color: #444; margin-bottom: 15px; }
            #file-gallery { display: block; }
            .preview-header { position: sticky !important; top: 0; background: #f8f9fa; z-index: 9999 !important; pointer-events: auto !important; display: flex; justify-content: space-between; align-items: center; padding: 20px 30px; border-bottom: 1px solid #eee; }
            #pdf-preview-modal::-webkit-scrollbar { width: 8px; }
            #pdf-preview-modal::-webkit-scrollbar-track { background: transparent; }
            #pdf-preview-modal::-webkit-scrollbar-thumb { background: #777; border-radius: 20px; border: 2px solid transparent; background-clip: content-box; }
            #pdf-preview-modal::-webkit-scrollbar-thumb:hover { background: #666; background-clip: content-box; }
            #pdf-preview-modal::-webkit-scrollbar-button, #pdf-preview-modal::-webkit-scrollbar-corner { display: none !important; }
            .tooltip.export-mode { flex-direction: column; align-items: flex-start; min-width: 280px; padding: 16px 24px; transform: translateX(-50%) translateY(0); }
            .progress-wrapper { width: 100%; height: 4px; background: rgba(0, 0, 0, 0.1); border-radius: 4px; margin-top: 8px; overflow: hidden; display: none; }
            #snackbar.export-mode .progress-wrapper { display: block; }
            .progress-bar-fill { width: 0%; height: 100%; background: #28a745; transition: width 0.3s ease; }
            .tooltip.success .progress-bar-fill { background: #ffffff; }

            /* --- MOBILE RESPONSIVE QUERIES --- */
            @media (max-width: 768px) {
                :host { padding: 10px; }
                .app-card { padding: 15px; border-radius: 8px; }
                .interaction-grid { display: grid; grid-template-columns: 60px repeat(24, 80px); grid-template-rows: repeat(6, 50px); }
                .fret-header-row { display: grid; grid-template-columns: 60px repeat(24, 80px); margin-left: 40px; margin-bottom: 10px; }
                .controls { grid-template-columns: 1fr; gap: 20px; }
                .btn-group { flex-direction: column; }
                .btn-group .btn { width: 100%; }
                #alt-button-group { flex-wrap: wrap; }
                .alt-btn { flex: 1 1 45%; }
                #lead-sheet { padding: 20px 15px; }
                .sheet-container { overflow-x: auto; scroll-snap-type: x mandatory; display: flex; padding-bottom: 15px; }
                #session-grid { min-width: max-content; gap: 0; display: flex; min-height: 275px;} 
                .progression-slot { flex: 0 0 75vw !important; width: 75vw !important; scroll-snap-align: center; }
                .slot-actions { opacity: 1 !important; }
                .title-container { flex-direction: row; align-items: flex-start; gap: 5px; }
                .bank-list-container { overflow-x: auto; }
                .bank-header, .bank-row { min-width: 650px; } 
                .bank-row { padding-right: 40px; }
                .inline-edit-btn { opacity: 1 !important; }
                .row-delete-btn { opacity: 1 !important; right: 10px; }
                .bank-title { align-items: normal; flex-direction: column; gap: 10px; }
                .bank-btn { flex-direction: column; }
                .action-footer { flex-direction: column; gap: 10px; }
                .action-footer .btn { width: 100%; }
                .modal-content { width: 95%; height: 85vh; margin: 5% auto; }
                .modal-header { flex-direction: column; gap: 15px; text-align: center; }
                .modal-header div { width: 100%; flex-direction: column; }
                .modal-header .btn { width: 100%; }
            }
        </style>

        <div class="app-card">
            <header class="no-print">
                <div style="border-bottom: 1px solid #333; padding-bottom: 20px; margin-bottom: 20px;">
                    <svg width="300px" height="100%" viewBox="0 0 400 32" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:1.5;">
                        <g>
                            <g>
                                <use xlink:href="#_Image1" x="1" y="0" width="33px" height="29px" />
                                <g>
                                    <path d="M24.258,10.177l-9.874,9.874l-2.725,-2.725l9.874,-9.874l2.725,2.725Z" style="fill:#fff;" />
                                    <rect x="11.659" y="17.376" width="1.927" height="13.964" style="fill:#fff;" />
                                </g>
                            </g>
                            <path d="M40.885,3.347l-2.596,2.596l0,1.648l10.272,0l-2.056,2.056l0,14.7l4.282,0l0,-16.756l8.317,0l0,-4.244l-18.218,0Z" style="fill:#fff;fill-rule:nonzero;" />
                            <path d="M76.75,3.349l-12.319,-0.005l0,4.77l-5.803,5.803l0,10.431l4.285,0l0,-5.778l12.194,0l0,5.778l4.286,0l0,-18.355c0,-1.46 -1.184,-2.643 -2.643,-2.643Zm-1.643,12.993l-2.057,-2.057l-8.73,0l4.395,-4.395l0,-2.256l5.968,0c0.233,0 0.423,0.189 0.423,0.423l0,8.285Z" style="fill:#fff;fill-rule:nonzero;" />
                            <path d="M100.387,14.05l-1.409,-1.409l1.049,0l2.057,-2.057l0,-4.229c0,-1.661 -1.347,-3.008 -3.008,-3.008l-13.16,0l-2.057,2.056l0,7.335l2.98,2.98l-2.98,0l0,8.628l20.813,0l0,-6.012l-4.284,-4.284Zm-12.243,-6.416l9.028,0c0.347,0 0.628,0.281 0.628,0.627l0,3.299l-9.656,0l0,-3.926Zm12.243,14.339l-1.903,-1.904l-10.34,0l0,-4.223l7.98,0l4.263,4.263l0,1.863Z" style="fill:#fff;fill-rule:nonzero;" />
                            <path d="M126.678,15.761l-4.308,4.308l-10.647,0l0,-4.182l3.302,-3.302l0,-9.239l-4.285,0l0,7.463l-3.301,3.301l0,10.236l16.711,0l4.103,-4.103l0,-2.91l-1.575,-1.573Z" style="fill:#fff;fill-rule:nonzero;" />
                            <path d="M148.72,3.349l-12.319,-0.005l0,4.77l-5.803,5.803l0,10.431l4.285,0l0,-5.778l12.194,0l0,5.778l4.286,0l0,-18.355c0,-1.46 -1.184,-2.643 -2.643,-2.643Zm-1.643,12.993l-2.057,-2.057l-8.73,0l4.395,-4.395l0,-2.256l5.968,0c0.233,0 0.423,0.189 0.423,0.423l0,8.285Z" style="fill:#fff;fill-rule:nonzero;" />
                            <path d="M156.925,3.347l-2.596,2.596l0,1.648l10.272,0l-2.056,2.056l0,14.7l4.282,0l0,-16.756l8.317,0l0,-4.244l-18.218,0Z" style="fill:#fff;fill-rule:nonzero;" />
                            <path d="M194.739,3.348l0,6.713l-5.802,5.803l0,4.206l-6.443,0l0,-16.723l-4.284,0l0,21l13.153,0c1.035,-0.033 1.858,-0.882 1.859,-1.918l0,-4.79l5.802,-5.802l0,-8.49l-4.284,0Z" style="fill:#fff;fill-rule:nonzero;" />
                            <path d="M220.512,3.343l-17.943,0l0,9.833l6.114,0l5.802,5.802l0,3.114l2.256,2.256l4.402,0l0,-1.654l-3.711,-3.713l3.08,0c1.585,0 2.871,-1.285 2.871,-2.871l0,-9.893c0.001,-0.762 -0.301,-1.493 -0.84,-2.032c-0.539,-0.539 -1.269,-0.842 -2.032,-0.842Zm-1.416,10.665c0,0.182 -0.072,0.356 -0.201,0.485c-0.129,0.129 -0.303,0.201 -0.485,0.201l-2.149,0l-5.802,-5.802l-3.607,0l0,-1.264l11.558,0c0.182,0 0.357,0.072 0.485,0.201c0.129,0.128 0.201,0.303 0.201,0.486l0,5.693Zm-16.527,1.876l0,8.474l4.285,0l0,-6.417l-2.057,-2.057l-2.227,0Z" style="fill:#fff;fill-rule:nonzero;" />
                            <path d="M229.927,3.348c-1.491,0 -2.699,1.208 -2.699,2.699l0,5.79l4.11,4.11l12.422,0l0,-4.283l-10.649,0l-1.597,-1.597l0,-2.106c0.006,-0.183 0.156,-0.329 0.338,-0.329l16.191,0l0,-4.286l-18.117,0.002Zm-1.124,12.413l-1.575,1.573l0,2.91l4.103,4.103l16.711,0l0,-4.278l-14.932,0l-4.308,-4.308Z" style="fill:#fff;fill-rule:nonzero;" />
                            <g>
                                <clipPath id="_clip2">
                                    <rect x="260.375" y="6.851" width="138.087" height="23.015" />
                                </clipPath>
                                <g clip-path="url(#_clip2)">
                                    <g opacity="0.7">
                                        <path d="M267.178,18.174c0.709,0.154 1.249,0.463 1.65,0.91c0.386,0.463 0.571,1.049 0.571,1.775c0,0.926 -0.339,1.636 -1.018,2.13c-0.694,0.509 -1.696,0.756 -3.038,0.756l-4.966,0l0,-10.802l4.657,0c1.203,0 2.144,0.247 2.807,0.725c0.663,0.478 0.987,1.173 0.987,2.052c0,0.602 -0.139,1.111 -0.432,1.512c-0.293,0.417 -0.709,0.741 -1.218,0.941Zm-5.66,-4.29l0,3.92l3.439,0c0.879,0 1.542,-0.17 2.02,-0.509c0.478,-0.324 0.709,-0.818 0.709,-1.451c0,-0.633 -0.231,-1.126 -0.709,-1.466c-0.478,-0.324 -1.141,-0.494 -2.02,-0.494l-3.439,0Zm3.809,8.919c0.972,0 1.696,-0.17 2.19,-0.494c0.494,-0.324 0.74,-0.849 0.74,-1.543c0,-1.343 -0.972,-2.021 -2.93,-2.021l-3.809,0l0,4.058l3.809,0Z" style="fill:#888989;fill-rule:nonzero;" />
                                        <path d="M275.706,20.01l0,3.734l-1.126,0l0,-3.734l-4.318,-7.067l1.218,0l3.701,6.064l3.701,-6.064l1.141,0l-4.318,7.067Z" style="fill:#888989;fill-rule:nonzero;" />
                                        <path d="M305.68,14.31l0,-1.339l3.615,0c0.995,0 1.846,0.354 2.553,1.062c0.707,0.708 1.061,1.56 1.061,2.555l0,0.169c0,0.995 -0.354,1.847 -1.061,2.555c-0.708,0.708 -1.559,1.062 -2.553,1.062l-2.276,0l0,3.371l-1.338,0l0,-4.71l3.522,0c0.656,0 1.215,-0.231 1.677,-0.693c0.461,-0.462 0.692,-1.018 0.692,-1.67c0,-0.652 -0.231,-1.208 -0.692,-1.67c-0.462,-0.462 -1.02,-0.693 -1.677,-0.693l-3.522,0Z" style="fill:#888989;fill-rule:nonzero;stroke:#888989;stroke-width:0.49px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:2;" />
                                        <path d="M314.567,23.745l0,-10.774l1.338,0l0,4.71l4.553,0l0,-4.71l1.338,0l0,10.774l-1.338,0l0,-4.71l-4.553,0l0,4.71l-1.338,0Z" style="fill:#888989;fill-rule:nonzero;stroke:#888989;stroke-width:0.49px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:2;" />
                                        <path d="M328.837,14.31c-1.118,0 -2.072,0.395 -2.861,1.185c-0.79,0.79 -1.184,1.744 -1.184,2.863c0,0.544 0.103,1.062 0.308,1.555c0.205,0.492 0.497,0.928 0.877,1.308c0.379,0.38 0.815,0.672 1.307,0.877c0.759,0.308 1.538,0.382 2.338,0.223c0.8,-0.159 1.489,-0.528 2.069,-1.108c0.579,-0.58 0.949,-1.27 1.107,-2.07c0.159,-0.8 0.082,-1.578 -0.231,-2.332c-0.313,-0.754 -0.807,-1.36 -1.484,-1.816c-0.677,-0.457 -1.425,-0.685 -2.246,-0.685Zm-2.699,-0.616c0.825,-0.482 1.725,-0.723 2.699,-0.723c0.974,0 1.874,0.241 2.699,0.723c0.826,0.482 1.479,1.136 1.961,1.962c0.482,0.826 0.723,1.726 0.723,2.701c0,0.975 -0.241,1.875 -0.723,2.701c-0.482,0.826 -1.136,1.48 -1.961,1.962c-0.826,0.482 -1.725,0.723 -2.699,0.723c-0.974,0 -1.874,-0.241 -2.699,-0.723c-0.826,-0.482 -1.479,-1.136 -1.961,-1.962c-0.482,-0.826 -0.723,-1.726 -0.723,-2.701c0,-0.975 0.241,-1.875 0.723,-2.701c0.482,-0.826 1.136,-1.48 1.961,-1.962Z" style="fill:#888989;fill-rule:nonzero;stroke:#888989;stroke-width:0.49px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:2;" />
                                        <path d="M341.769,23.745l-4.553,-8.049l0,8.049l-1.338,0l0,-10.774l1.338,0l4.553,8.049l0,-8.049l1.338,0l0,10.774l-1.338,0Z" style="fill:#888989;fill-rule:nonzero;stroke:#888989;stroke-width:0.49px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:2;" />
                                        <path d="M350.147,14.31c-1.118,0 -2.071,0.395 -2.861,1.185c-0.79,0.79 -1.184,1.744 -1.184,2.863c0,0.544 0.103,1.062 0.308,1.555c0.205,0.492 0.497,0.928 0.877,1.308c0.379,0.38 0.815,0.672 1.307,0.877c0.759,0.308 1.538,0.382 2.338,0.223c0.8,-0.159 1.489,-0.528 2.069,-1.108c0.579,-0.58 0.949,-1.27 1.107,-2.07c0.159,-0.8 0.082,-1.578 -0.231,-2.332c-0.313,-0.754 -0.807,-1.36 -1.484,-1.816c-0.677,-0.457 -1.425,-0.685 -2.246,-0.685Zm-2.699,-0.616c0.825,-0.482 1.725,-0.723 2.699,-0.723c0.974,0 1.874,0.241 2.699,0.723c0.825,0.482 1.479,1.136 1.961,1.962c0.482,0.826 0.723,1.726 0.723,2.701c0,0.975 -0.241,1.875 -0.723,2.701c-0.482,0.826 -1.136,1.48 -1.961,1.962c-0.826,0.482 -1.725,0.723 -2.699,0.723c-0.974,0 -1.874,-0.241 -2.699,-0.723c-0.826,-0.482 -1.479,-1.136 -1.961,-1.962c-0.482,-0.826 -0.723,-1.726 -0.723,-2.701c0,-0.975 0.241,-1.875 0.723,-2.701c0.482,-0.826 1.136,-1.48 1.961,-1.962Z" style="fill:#888989;fill-rule:nonzero;stroke:#888989;stroke-width:0.49px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:2;" />
                                        <path d="M362.579,12.971c0.81,0 1.579,0.174 2.307,0.523c0.728,0.349 1.348,0.836 1.861,1.462l-1.169,0.693c-0.728,-0.811 -1.636,-1.252 -2.723,-1.324c-1.087,-0.072 -2.046,0.241 -2.876,0.939c-0.831,0.698 -1.305,1.585 -1.423,2.663c-0.118,1.077 0.156,2.044 0.823,2.901c0.667,0.857 1.536,1.365 2.607,1.524c1.072,0.159 2.048,-0.074 2.93,-0.7l-0.323,-0.493l-0.538,-0.785l-0.908,-1.339l1.63,0l0.769,1.139l0.431,0.646l0.185,0.262l1.8,2.663l-1.615,0l-0.677,-0.985c-0.943,0.657 -1.997,0.985 -3.161,0.985c-1.164,0 -2.21,-0.347 -3.138,-1.04c-0.928,-0.694 -1.569,-1.595 -1.923,-2.705c-0.354,-1.11 -0.349,-2.217 0.015,-3.321c0.364,-1.105 1.018,-1.999 1.961,-2.682c0.943,-0.683 1.994,-1.025 3.153,-1.025Z" style="fill:#888989;fill-rule:nonzero;stroke:#888989;stroke-width:0.49px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:2;" />
                                        <path d="M368.538,14.31l0,-1.339l3.615,0c0.995,0 1.846,0.354 2.553,1.062c0.708,0.708 1.062,1.56 1.062,2.555l0,0.169c0,0.77 -0.223,1.467 -0.669,2.093c-0.446,0.626 -1.028,1.067 -1.746,1.324l2.415,3.571l-1.631,0l-1.738,-2.586l-0.538,-0.785l-0.908,-1.339l1.107,0c0.656,0 1.215,-0.231 1.677,-0.693c0.461,-0.462 0.692,-1.018 0.692,-1.67c0,-0.652 -0.231,-1.208 -0.692,-1.67c-0.461,-0.462 -1.02,-0.693 -1.677,-0.693l-3.522,0Z" style="fill:#888989;fill-rule:nonzero;stroke:#888989;stroke-width:0.49px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:2;" />
                                        <path d="M381.194,12.971l1.415,0l3.767,10.774l-1.43,0l-3.045,-8.727l-3.061,8.727l-1.415,0l3.769,-10.774Z" style="fill:#888989;fill-rule:nonzero;stroke:#888989;stroke-width:0.49px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:2;" />
                                        <path d="M396.295,12.971l2.168,0l0,10.774l-1.353,0l0,-9.05l-3.153,9.05l-1.415,0l-3.169,-9.05l0,9.05l-1.338,0l0,-10.774l2.169,0l3.046,8.742l3.046,-8.742Z" style="fill:#888989;fill-rule:nonzero;stroke:#888989;stroke-width:0.49px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:2;" />
                                        <path d="M295.672,19.334l1.987,-1.988c0.022,-0.02 0.044,-0.041 0.064,-0.064c0.114,-0.129 0.183,-0.301 0.183,-0.49c0,-0.185 -0.067,-0.354 -0.177,-0.482c-0.024,-0.027 -0.049,-0.053 -0.077,-0.077l-3.562,-3.564c-0.013,-0.014 -0.026,-0.028 -0.041,-0.041c-0.124,-0.114 -0.287,-0.184 -0.466,-0.184c-0.208,0 -0.395,0.094 -0.523,0.244l-0.003,0l-2.358,2.36l-0.011,-3.888c0.012,-0.17 0.08,-0.324 0.186,-0.441l2.25,-2.251c0.123,-0.111 0.284,-0.179 0.46,-0.179c0.171,0 0.328,0.064 0.45,0.17l7.859,7.863c0.104,0.127 0.167,0.291 0.167,0.47c0,0.182 -0.065,0.348 -0.171,0.476l-6.37,6.374l-0.014,-3.861c0.005,-0.17 0.068,-0.326 0.168,-0.447Z" style="fill:#a4a4a4;" />
                                        <path d="M290.699,23.337l0,-5.478c0.008,-0.181 0.081,-0.344 0.194,-0.467l2.231,-2.232c0.12,-0.1 0.273,-0.161 0.439,-0.161c0.175,0 0.335,0.067 0.458,0.177l1.125,1.126c0.116,0.13 0.187,0.303 0.187,0.494c0,0.19 -0.07,0.362 -0.185,0.492l-1.245,1.246l-0.014,0.011c-0.035,0.029 -0.067,0.062 -0.096,0.098c-0.087,0.109 -0.145,0.244 -0.159,0.392c-0.001,0.015 -0.002,0.031 -0.003,0.046c-0,0.009 -0,0.017 -0,0.026c0,0.024 0.001,0.049 0.003,0.072l0,6.055c-0.007,0.173 -0.073,0.33 -0.177,0.451l-2.572,2.573c-0.121,0.104 -0.277,0.167 -0.446,0.167c-0.029,0 -0.057,-0.002 -0.085,-0.005c-0.018,-0.003 -0.037,-0.006 -0.055,-0.009c-1.043,-0.188 -1.835,-1.102 -1.835,-2.199c0,-1.03 0.698,-1.898 1.646,-2.156c0.011,-0.002 0.022,-0.004 0.033,-0.006c0.022,-0.005 0.045,-0.011 0.066,-0.018c0.283,-0.093 0.488,-0.368 0.488,-0.692l0,-0.004l0.001,0Z" style="fill:#a4a4a4;" />
                                    </g>
                                </g>
                            </g>
                        </g>
                        <defs>
                            <image id="_Image1" width="33px" height="29px" xlink:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACEAAAAdCAYAAAAkXAW5AAAACXBIWXMAAA7EAAAOxAGVKw4bAAAA7klEQVRIie3XvzJDURCA8d8ikQgZag+hUvMmCm+novYeShWVofAnySWyiuTqQjLmXhPuN3NmTnFmvy3O2bMb5pCZfeyjj02szTs7h3cUeMAtRhGRS8Zo+KcEZGbgGIfYqtj5ggtcR8S4YlfDilJezF65r5HEMCImkZkdnKL7C0mc4aZmb8MKEJnZxgl2anY/4Twi7sonum35puWnvKGIiEnN3oYV4PO/yMwujnCguhI+wCWuIqKoyNHwB/iykcnMddMRcBd7piNh65uYIzziHs8WqIoLdVOZuYH2bPXQmSXTwgRj0zI8wBCvi8hLPgCX8UMIJe++DQAAAABJRU5ErkJggg==" />
                        </defs>
                    </svg>
                    <h1 style="font-size: 0.8rem; font-weight: 400; color: #888; letter-spacing: 1px; ">Free Guitar Chord Diagram & Progression Creator</h1>
                </div>
                <div class="sub-header">Create your chord on the fretboard below</div>
            </header>

            <div class="no-print">
                <div id="fretboard-mount"></div>
                <div class="controls">
                    <div>
                        <label style="color:#888; font-size: 1rem; text-transform: uppercase;">Chord Name</label>
                        <div class="chord-name-container">
                            <h2 id="chordNameDisplay" contenteditable="false" spellcheck="false">Chord Name</h2>
                            <svg class="edit-icon" data-action="enableChordEdit" width="20" height="20" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                        </div>
                        <div id="notesDisplay"></div>
                        <p style="color:#888; font-size: 1rem; margin-top: 20px; margin-bottom: 12px;">Suggested Alternate Chord Names</p>
                        <div id="alt-button-group" style="display: flex; gap: 8px; justify-content: left; ">
                            <button class="alt-btn" id="alt-0" data-action="setAltChord" data-param="0" disabled>—</button>
                            <button class="alt-btn" id="alt-1" data-action="setAltChord" data-param="1" disabled>—</button>
                            <button class="alt-btn" id="alt-2" data-action="setAltChord" data-param="2" disabled>—</button>
                            <button class="alt-btn" id="alt-3" data-action="setAltChord" data-param="3" disabled>—</button>
                        </div>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-primary" id="btnAddTop" data-action="addChordToSheet">Add to Sheet</button>
                        <button class="btn btn-secondary" id="btn-clear-chord" data-action="clearFretboard" disabled>Clear Chord</button>
                    </div>
                </div>
            </div>

            <div id="lead-sheet" data-action="deselectAllSlots">
                <div class="title-container" data-stop="true">
                    <div id="songTitleDisplay" contenteditable="false" spellcheck="false">SONG TITLE</div>
                    <svg class="no-print edit-icon" width="14" height="14" viewBox="0 0 24 24" data-action="handleTitleEditClick" data-stop="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                </div>
                <div style="display: flex; flex-direction: row; gap: 20px; align-items: baseline; line-height: 2rem;">
                    <div id="keyDisplay">Key: -</div>
                     <div id="bpmDisplay" style="display: flex; align-items: baseline; gap: 8px;">
                        <span style="font-size: 1rem; color: #444;">BPM:</span>
                        <span id="bpm-value" style="font-size: 1.4rem; outline: none; cursor: pointer; min-width: 5px;"></span>
                        <svg class="edit-icon" id="edit-bpm-btn" viewBox="0 0 24 24" width="14" height="14" style="position: relative; top: 2px; cursor: pointer;">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                    </div>
                </div>
                <div class="sheet-container">
                    <div id="session-grid"></div>
                </div>
            </div>

            <div class="action-footer no-print">
                <button class="btn btn-primary btn-wide" id="btn-save-progression" data-action="saveProgressionToFile" disabled>Save Progression</button>
                <button class="btn btn-secondary btn-wide" id="btn-clear-sheet" data-action="resetFullProgression" disabled>Clear Sheet</button>
            </div>

            <div id="bank-container" class="no-print" style="margin-top: 50px; border-top: 1px solid #333; padding-top: 30px;">
                <div class="bank-title">
                    <h3 style="font-weight: 200; letter-spacing: 2px; margin: 0;">PROGRESSION BANK</h3>
                    <div class="bank-btn">
                        <button id="export-pdf-btn" class="btn btn-secondary" disabled data-action="exportSelectedToPDF">Export Selected (PDF)</button>
                        <button id="btn-delete-selected" class="btn btn-secondary" disabled data-action="openDeleteModal">Delete Selected</button>
                    </div>
                </div>
                <div class="bank-list-container">
                    <div class="bank-header">
                        <div class="col-check"><input type="checkbox" id="select-all-bank" data-action="toggleAllCheckboxes"></div>
                        <div class="sort-header active desc" data-action="handleSort" data-param="title" data-col="title">Name <span class="sort-arrow-wrap"><svg class="sort-arrow inactive" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg></span></div>
                        <div class="sort-header" data-action="handleSort" data-param="key" data-col="key">Key <span class="sort-arrow-wrap"><svg class="sort-arrow inactive" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg></span></div>
                        <div class="sort-header" data-action="handleSort" data-param="bpm" data-col="bpm">BPM <span class="sort-arrow-wrap"><svg class="sort-arrow inactive" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg></span></div>
                        <div class="sort-header active desc" data-action="handleSort" data-param="lastModified" data-col="lastModified">Last Modified <span class="sort-arrow-wrap"><svg class="sort-arrow desc" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg></span></div>
                    </div>
                    <div id="file-gallery">Your saved progressions will appear here</div>
                </div>
            </div> 

            <div id="strum-modal" class="strum-modal no-print" data-stop="true">
                <div class="modal-drag-handle" id="strum-handle">
                    <h3 id="strum-target-name">Strum: Chord</h3>
                    <button class="close-modal-btn" data-action="deselectAllSlots" title="Close">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="strum-toolbar">
                    <button class="tool-btn active" id="tool-d" data-action="setTool" data-param="d" title="Downstroke">&darr;</button>
                    <button class="tool-btn" id="tool-u" data-action="setTool" data-param="u" title="Upstroke">&uarr;</button>
                    <button class="tool-btn" id="tool-m" data-action="setTool" data-param="m" title="Mute">X</button>
                    <button class="tool-btn" id="tool-erase" data-action="setTool" data-param="" title="Eraser">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" /></svg>
                    </button>
                    <select class="res-dropdown" id="resSelect" data-action="changeResolution">
                        <option value="1">1/1</option><option value="2">1/2</option><option value="4" selected>1/4</option><option value="8">1/8</option><option value="16">1/16</option>
                    </select>
                </div>
                <div class="strum-grid-container" id="strum-grid"></div>
                <div class="strum-footer">
                    <button class="btn btn-primary btn-sm" data-action="insertStrumming">Insert Pattern</button>
                    <button class="tool-btn" id="tool-clear" data-action="clearStrumPattern" title="Clear Pattern" style="margin-left: 8px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                    </button>
                </div>
            </div> 
        </div> 

        <div id="snackbar">
            <div style="display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;">
                <div id="snackbar-text"></div>
                <div class="sb-icon icon-warn">!</div>
                <div class="sb-icon icon-success">✓</div>
            </div>
            <div class="progress-wrapper">
                <div id="export-progress-bar" class="progress-bar-fill"></div>
            </div>
        </div>

        <div id="pdf-preview-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 style="margin:0; font-size: 0.9rem; letter-spacing: 2px;">TABLATURE | PRINT PREVIEW</h2>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-success btn-wide" data-action="triggerFinalPDF">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; position: relative; top: -1px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            Download PDF
                        </button>
                        <button class="btn btn-secondary btn-wide" data-action="closePreview">Cancel</button>
                    </div>
                </div>
                <div class="preview-body">
                    <div id="pdf-pages-staging"></div>
                </div>
            </div>
        </div>

        <div id="custom-confirm-modal" style="display: none; position: fixed; z-index: 4000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.8); align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: #1e1e1e; padding: 30px; border-radius: 8px; border: 1px solid #333; max-width: 400px; text-align: center; box-shadow: 0 15px 40px rgba(0,0,0,0.8);">
                <h3 style="margin-top: 0; color: #fff; font-weight: 600; font-size: 1.2rem; font-family: 'Outfit', sans-serif;">Overwrite Session?</h3>
                <p id="confirm-modal-msg" style="color: #bbb; line-height: 1.5; margin-bottom: 25px; font-family: 'Outfit', sans-serif;">Message goes here</p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button class="btn btn-primary btn-wide" id="confirm-btn-ok">Overwrite</button>
                    <button class="btn btn-secondary btn-wide" data-action="cancelOverwrite">Cancel</button>
                </div>
            </div>
        </div>

        <div id="delete-confirm-modal" class="modal-overlay" style="display: none;">
            <div class="confirm-card">
                <div style="width:50px; height:50px; background:#db3069; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 15px; font-weight:900;">!</div>
                <h3>Confirm Deletion</h3>
                <p id="delete-confirm-text">This will permanently delete your progression.</p>
                <div class="confirm-actions">
                    <button data-action="confirmDelete" class="btn btn-primary">Delete Permanently</button>
                    <button class="btn btn-secondary" data-action="closeDeleteModal">Cancel</button>
                </div>
            </div>
        </div>
        `;
    }

    // ========================================== //
    // --- APP INITIALIZATION & EVENTS ---        //
    // ========================================== //
    initApp() {
        const supabaseUrl = 'https://wcqahyhmjgbombrrdoqr.supabase.co';
        const supabaseKey = 'sb_publishable_rxgMgUb0z94bdBVN7xJOoA_Azbcduwm';
        if (window.supabase) {
            this.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
        }

        this.initBpmListeners();
        this.makeDraggable(this.$("strum-modal"));
        
        window.addEventListener('mouseup', () => { this.isPaintingStrums = false; });
        window.addEventListener('resize', () => {
            this.renderSheet();
            if(this.selectedSlotIndex !== null) this.updateStrumModalVisibility();
        });

        this.renderFretboard();
        this.renderSheet();
        this.requestCloudSessions();
        this.updateSortHeaderUI();
    }

    // Helper for Shadow DOM Selection
    $(id) {
        return this.shadowRoot.getElementById(id);
    }
    
    $$(sel) {
        return this.shadowRoot.querySelectorAll(sel);
    }

    attachDelegatedEvents() {
        this.shadowRoot.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            
            if (!target) {
                // If clicked outside, deselect slots
                if (e.target.closest('#lead-sheet')) {
                    this.deselectAllSlots();
                }
                return;
            }

            if (target.hasAttribute('data-stop')) e.stopPropagation();

            const action = target.getAttribute('data-action');
            const param = target.getAttribute('data-param');

            switch(action) {
                case 'enableChordEdit': this.enableChordEdit(); break;
                case 'addChordToSheet': this.addChordToSheet(); break;
                case 'clearFretboard': this.clearFretboard(); break;
                case 'handleTitleEditClick': this.handleTitleEditClick(); break;
                case 'saveProgressionToFile': this.saveProgressionToFile(); break;
                case 'resetFullProgression': this.resetFullProgression(); break;
                case 'exportSelectedToPDF': this.exportSelectedToPDF(); break;
                case 'openDeleteModal': this.openDeleteModal(param || null, e); break;
                case 'closeDeleteModal': this.closeDeleteModal(); break;
                case 'confirmDelete': this.confirmDelete(); break;
                case 'handleSort': this.handleSort(param); break;
                case 'setTool': this.setTool(param); break;
                case 'clearStrumPattern': this.clearStrumPattern(); break;
                case 'insertStrumming': this.insertStrumming(); break;
                case 'triggerFinalPDF': this.triggerFinalPDF(); break;
                case 'closePreview': this.closePreview(); break;
                case 'deselectAllSlots': this.deselectAllSlots(); break;
                case 'addEmptyBar': this.addEmptyBar(); break;
                case 'handleDelete': this.handleDelete(Number(param)); break;
                case 'loadChordToFretboard': this.loadChordToFretboard(Number(param)); break;
                case 'handleCopyChord': this.handleCopyChord(Number(param)); break;
                case 'handlePasteChord': this.handlePasteChord(Number(param)); break;
                case 'handleStrumClick': this.handleStrumClick(Number(param)); break;
                case 'handleCopyStrum': this.handleCopyStrum(Number(param)); break;
                case 'handlePasteStrum': this.handlePasteStrum(Number(param)); break;
                case 'loadProgressionById': this.loadProgressionById(param); break;
                case 'startInlineRename': this.startInlineRename(param, e); break;
                case 'cancelOverwrite': this.$('custom-confirm-modal').style.display = 'none'; break;
                case 'setAltChord': this.setAltChord(param, target); break;
            }
        });

        // Checkbox event delegation
        this.shadowRoot.addEventListener('change', (e) => {
            // Explicitly handle checkboxes even if they lack data-action
            if (e.target.classList.contains('bank-checkbox')) {
                this.updateSelectionState();
                return;
            }
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.getAttribute('data-action');
            if (action === 'changeResolution') this.changeResolution(target.value);
            if (action === 'toggleAllCheckboxes') this.toggleAllCheckboxes(target);
        });
    }

    updateLeadSheetButtons() {
        const btnSave = this.$('btn-save-progression');
        const btnClear = this.$('btn-clear-sheet');
        const hasProgression = this.progressionData.some(chord => !chord.isEmpty);
        if (btnSave) btnSave.disabled = !hasProgression;
        const title = this.$('songTitleDisplay').innerText.trim();
        const bpm = this.$('bpm-value').innerText.trim();
        const hasAnyChange = this.progressionData.length > 0 || (title !== "SONG TITLE" && title !== "") || bpm !== "";
        if (btnClear) btnClear.disabled = !hasAnyChange;
    }

    async requestCloudSessions() {
        if (!this.supabaseClient) return;
        this.$('file-gallery').innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">Loading cloud sessions...</div>';
        try {
            const { data, error } = await this.supabaseClient.from('progressions').select('*').order('id', { ascending: false });
            if (error) throw error;
            this.cloudBankData = data.map(item => ({
                id: item.id,
                title: item.title,
                key: item.song_key,
                bpm: item.bpm,
                chords: item.payload,
                lastModified: new Date(item.updated_at || item.created_at || Date.now())
            }));
            this.renderCloudGallery();
        } catch (err) {
            console.error("DB Load Error:", err);
            this.showTooltip("Error connecting to cloud", "warning");
        }
    }

    initBpmListeners() {
        const bpmValue = this.$('bpm-value');
        const editBpmBtn = this.$('edit-bpm-btn');

        [bpmValue, editBpmBtn].forEach(el => {
            if(!el) return;
            el.addEventListener('click', () => {
                this.previousBpm = bpmValue.innerText;
                bpmValue.contentEditable = true;
                editBpmBtn.style.visibility = 'hidden';
                bpmValue.focus();
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(bpmValue);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            });
        });

        bpmValue.addEventListener('blur', () => {
            bpmValue.contentEditable = false;
            editBpmBtn.style.visibility = 'visible';
            let val = bpmValue.innerText.trim();
            if (val !== "" && isNaN(val)) bpmValue.innerText = this.previousBpm;
            this.updateLeadSheetButtons();
        });

        bpmValue.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); bpmValue.blur(); }
            if (e.key === 'Escape') { bpmValue.innerText = this.previousBpm; bpmValue.blur(); }
        });
    }

    updateClearChordButtonState() {
        const btnClearChord = this.$('btn-clear-chord');
        if (btnClearChord) btnClearChord.disabled = this.currentFrets.every(f => f === -1);
    }

    renderFretboard() {
        let grid = this.$('interaction-grid');
        const mount = this.$('fretboard-mount');
        const area = this.shadowRoot.querySelector('.fretboard-layout');
        const scrollPos = area ? area.scrollLeft : 0;

        this.shadowRoot.addEventListener('wheel', (e) => {
            const fretboard = e.target.closest('.fretboard-layout');
            if (fretboard) { e.preventDefault(); fretboard.scrollLeft += e.deltaY * 1.0; }
        }, { passive: false });

        if (!grid) {
            const fretHeaders = Array.from({length: 24}, (_, i) => `<div class="fret-number">${i+1}</div>`).join('');
            const visualFrets = Array.from({length: 24}, (_, i) => `<div class="v-fret" style="left:${((i+1)/24)*100}%;"></div>`).join('');

            mount.innerHTML = `
                <div class="fret-wrap">
                    <div class="fretboard-layout">
                        <div class="fret-header-row"><div class="fret-number">OPEN</div>${fretHeaders}</div>
                        <div class="fretboard-core-wrap">
                            <div class="string-labels-col">${this.tuning.map(t => `<div class="string-label">${window.Tonal.Note.get(t).pc}</div>`).join('')}</div>
                            <div class="fretboard-interactive-area">
                                <div class="visual-grid">
                                    ${[0,20,40,60,80,100].map(p => `<div class="v-string" style="top:${p}%;"></div>`).join('')}
                                    ${visualFrets}
                                    <div class="v-nut"></div>
                                </div>
                                <div class="interaction-grid" id="interaction-grid"></div>
                            </div>
                        </div>
                    </div>
                </div>`;
            grid = this.$('interaction-grid');
        }

        grid.innerHTML = '';
        
        this.tuning.forEach((note, s) => {
            const nutZone = document.createElement('div'); 
            nutZone.className = 'click-zone';
            nutZone.addEventListener('click', (e) => {
                e.stopPropagation();
                const current = this.currentFrets[s];
                if (current === -1 || current > 0) this.currentFrets[s] = 0; 
                else if (current === 0) this.currentFrets[s] = -2; 
                else this.currentFrets[s] = -1; 
                this.isUserEditingChord = false; 
                this.renderFretboard(); 
            });

            if (this.currentFrets[s] === 0) nutZone.innerHTML = `<div class="note-visual open-dot">${window.Tonal.Note.get(note).pc}</div>`;
            else if (this.currentFrets[s] === -2) nutZone.innerHTML = '<div class="note-visual muted-x">X</div>';
            grid.appendChild(nutZone);

            for (let f = 1; f <= 24; f++) {
                const fretZone = document.createElement('div'); 
                fretZone.className = 'click-zone';
                fretZone.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.currentFrets[s] = (this.currentFrets[s] === f) ? -1 : f; 
                    this.isUserEditingChord = false; 
                    this.renderFretboard(); 
                });
                
                if (this.currentFrets[s] === f) { 
                    const pc = window.Tonal.Note.get(window.Tonal.Note.transpose(note, window.Tonal.Interval.fromSemitones(f))).pc; 
                    fretZone.innerHTML = `<div class="note-visual fretted-dot">${pc}</div>`; 
                }
                grid.appendChild(fretZone);
            }
        });

        const newArea = this.shadowRoot.querySelector('.fretboard-layout');
        if (newArea && scrollPos !== 0) newArea.scrollLeft = scrollPos;

        this.updateAnalysis();
        this.updateClearChordButtonState();
    }

    updateAnalysis() {
        let noteOrder = this.currentFrets.map((f, i) => f === -2 ? "X" : (f === -1 ? "-" : window.Tonal.Note.get(window.Tonal.Note.transpose(this.tuning[i], window.Tonal.Interval.fromSemitones(f))).pc));
        this.$('notesDisplay').innerText = [...noteOrder].reverse().join(" ");
        if (this.isUserEditingChord) return;
        
        let activeNotes = [];
        let bassNote = null;
        for (let i = 5; i >= 0; i--) { 
            if (this.currentFrets[i] >= 0) { 
                const note = window.Tonal.Note.transpose(this.tuning[i], window.Tonal.Interval.fromSemitones(this.currentFrets[i])); 
                activeNotes.push(note); 
                if (bassNote === null) bassNote = window.Tonal.Note.get(note).pc; 
            } 
        }

        const resetButtons = () => {
            for(let i=0; i<4; i++) {
                const btn = this.$(`alt-${i}`);
                btn.innerText = "—"; btn.disabled = true; btn.className = "alt-btn";
            }
        };

        if (activeNotes.length === 0) { 
            this.$('chordNameDisplay').innerText = "Chord Name"; 
            resetButtons();
            this.currentlySelectedChordName = "";
            return; 
        }
        
        let pcSet = [...new Set(activeNotes.map(n => window.Tonal.Note.get(n).pc))];
        let processedNames = window.Tonal.Chord.detect(pcSet);

        if (processedNames.length === 0) {
            const allTypes = window.Tonal.ChordType.all();
            let candidates = [];
            for (let root of pcSet) {
                for (let type of allTypes) {
                    const chordNotes = window.Tonal.Chord.getChord(type.aliases[0], root).notes;
                    const intersection = pcSet.filter(n => chordNotes.includes(n));
                    if (intersection.length >= 3) candidates.push({ name: root + (type.aliases[0] || type.name), score: intersection.length });
                }
            }
            processedNames = candidates.sort((a,b) => b.score - a.score).map(c => c.name);
        }

        processedNames = [...new Set(processedNames.map(name => {
            let root = name.match(/^[A-G][#b]?/)?.[0];
            let base = name.split('/')[0].replace("Major", "").replace("Minor", "m").replace(/M$/, "").replace(/no\d+/g, ""); 
            if (root && bassNote && root.toUpperCase() !== bassNote.toUpperCase()) return base + "/" + bassNote;
            return base;
        }))];

        this.currentlySelectedChordName = processedNames[0] || "Custom Chord";
        this.$('chordNameDisplay').innerText = this.currentlySelectedChordName;

        resetButtons();
        const alternates = processedNames.slice(1, 5); 

        alternates.forEach((altName, index) => {
            const btn = this.$(`alt-${index}`);
            btn.innerText = altName; btn.disabled = false; btn.className = "alt-btn active";
        });
    }

    setAltChord(param, btn) {
        this.currentlySelectedChordName = btn.innerText;
        this.$('chordNameDisplay').innerText = btn.innerText;
        this.$$('.alt-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
    }

    clearFretboard() { 
        this.currentFrets = [-1,-1,-1,-1,-1,-1]; 
        this.isUserEditingChord = false; 
        this.renderFretboard(); 
    }

    enableChordEdit() {
        const chordEl = this.$('chordNameDisplay');
        chordEl.contentEditable = "true";
        this.isUserEditingChord = true;
        chordEl.focus();
        chordEl.onblur = () => { chordEl.contentEditable = "false"; };
        chordEl.onkeydown = (e) => { if(e.key === 'Enter') chordEl.blur(); };
    }

    handleTitleEditClick() {
        const titleEl = this.$('songTitleDisplay');
        titleEl.contentEditable = "true";
        const previousValue = titleEl.innerText.trim();
        if (previousValue === "SONG TITLE") titleEl.innerText = "";
        titleEl.focus();
        
        titleEl.onblur = () => {
            const newValue = titleEl.innerText.trim();
            if (newValue === "") {
                titleEl.innerText = this.lastUserTitle;
            } else {
                this.lastUserTitle = newValue;
                this.titleHasBeenEdited = true;
            }
            titleEl.contentEditable = "false";
            this.updateLeadSheetButtons();
        };
        titleEl.onkeydown = (e) => { if(e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } };
    }

    resetFullProgression() {
        const title = this.$('songTitleDisplay');
        const bpm = this.$('bpm-value');
        if (title) title.innerText = "SONG TITLE";
        if (bpm) bpm.innerText = "";
        this.titleHasBeenEdited = false;
        this.lastUserTitle = "SONG TITLE";
        this.progressionData = [];
        this.deselectAllSlots(); 
        this.renderSheet(); 
    }

    addEmptyBar() {
        if (this.progressionData.length < 4) {
            this.progressionData.push({ isEmpty: true, frets: [-1,-1,-1,-1,-1,-1], name: '', resolution: 4, pattern: ['d','','',''] });
            this.renderSheet();
        }
    }

    handleDelete(index) {
        if (this.progressionData[index].isEmpty) {
            this.progressionData.splice(index, 1);
            if(this.selectedSlotIndex === index) this.deselectAllSlots();
        } else {
            this.progressionData[index] = { isEmpty: true, frets: [-1,-1,-1,-1,-1,-1], name: '', resolution: 4, pattern: ['d','','',''] };
        }
        this.renderSheet();
    }

    addChordToSheet() {
        if (this.currentFrets.every(f => f === -1)) {
            this.showTooltip("Create a chord on the fretboard first", "warning");
            return;
        }

        const currentName = this.$('chordNameDisplay').innerText;

        if (this.selectedSlotIndex !== null) {
            const target = this.progressionData[this.selectedSlotIndex];
            this.progressionData[this.selectedSlotIndex] = {
                ...target, 
                name: currentName,
                frets: [...this.currentFrets],
                isEmpty: false,
                resolution: target.resolution || 4,
                pattern: target.pattern || ['d', '', '', '']
            };
            this.renderSheet();
            setTimeout(() => this.updateStrumModalVisibility(), 20);
            this.showTooltip("Chord updated", "success");
        } else {
            if (this.progressionData.length < 4) {
                this.progressionData.push({ 
                    name: currentName, frets: [...this.currentFrets], resolution: 4, pattern: ['d', '', '', ''], isEmpty: false 
                });
                this.renderSheet();
            }
        }
    }

    loadChordToFretboard(index) {
        const chord = this.progressionData[index];
        this.selectedSlotIndex = index; 
        
        if (chord && !chord.isEmpty) {
            this.currentFrets = [...chord.frets];
            this.isUserEditingChord = true; 
            this.$('chordNameDisplay').innerText = chord.name;
            this.renderFretboard(); 
            this.showTooltip("Loaded to Fretboard", "success");
        }
        this.renderSheet();
        this.updateStrumModalVisibility();
    }

    handleStrumClick(index) {
        this.selectedSlotIndex = (this.selectedSlotIndex === index) ? null : index;
        this.renderSheet(); 
        this.updateStrumModalVisibility();
    }

    deselectAllSlots() {
        if (this.selectedSlotIndex !== null) {
            this.selectedSlotIndex = null;
            this.updateStrumModalVisibility();
            this.renderSheet();
        }
    }

    renderSheet() {
        const grid = this.$('session-grid');
        grid.innerHTML = ''; 

        this.progressionData.forEach((item, index) => {
            const slot = document.createElement('div');
            slot.className = `progression-slot ${this.selectedSlotIndex === index ? 'selected' : ''}`;
            const pasteChordClass = this.clipboardChordOnly === null ? 'disabled' : '';
            const pasteStrumClass = this.clipboardStrumOnly === null ? 'disabled' : '';
            const hasChord = !item.isEmpty;

            slot.innerHTML = `
                <div class="slot-actions no-print" style="top: 8px; right: 8px;">
                    <button class="action-icon-btn" data-action="handleDelete" data-param="${index}" data-stop="true" title="Delete Bar">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y1="17"></line><line x1="14" y1="11" x2="14" y1="17"></line></svg>
                    </button>
                </div>
                <div class="chord-edit-zone" data-action="loadChordToFretboard" data-param="${index}" data-stop="true" style="width: 100%; cursor: pointer; position: relative; z-index: 5;" title="Click to edit chord">
                    <div class="chord-label">${item.isEmpty ? '' : item.name}</div>
                    <div class="diag-wrapper"><div id="diag-svg-${index}"></div></div>
                </div>
                <div class="slot-actions no-print" style="top: 70px; right: 32px; flex-direction: row; gap: 6px; z-index: 10;">
                    ${hasChord ? `<button class="action-icon-btn" data-action="handleCopyChord" data-param="${index}" data-stop="true" title="Copy Chord"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>` : ''}
                    <button class="action-icon-btn ${pasteChordClass}" data-action="handlePasteChord" data-param="${index}" data-stop="true" title="Paste Chord"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg></button>
                </div>
                <div class="strum-edit-zone" data-action="handleStrumClick" data-param="${index}" data-stop="true" style="width: 100%; flex: 1; display: flex; flex-direction: column; cursor: pointer; position: relative; z-index: 5;" title="Click to edit strumming">
                    <div class="tab-wrapper" id="tab-svg-${index}"></div>
                </div>
                <div class="slot-actions no-print" style="bottom: 150px; right: 8px; flex-direction: row; gap: 6px; z-index: 10;">
                    <button class="action-icon-btn" data-action="handleCopyStrum" data-param="${index}" data-stop="true" title="Copy Strum Pattern"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
                    <button class="action-icon-btn ${pasteStrumClass}" data-action="handlePasteStrum" data-param="${index}" data-stop="true" title="Paste Strum Pattern"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg></button>
                </div>
            `;
            grid.appendChild(slot);
        });

        const canAddNormally = this.progressionData.length < 4;
        const isSlotSelected = this.selectedSlotIndex !== null;
        
        if (canAddNormally) {
            const addBtnWrapper = document.createElement('div');
            addBtnWrapper.style.display = 'flex';
            addBtnWrapper.style.alignItems = 'center';
            addBtnWrapper.style.justifyContent = 'center';
            
            if (window.innerWidth <= 768) {
                addBtnWrapper.style.minWidth = '60px';
                addBtnWrapper.style.scrollSnapAlign = 'center';
                addBtnWrapper.innerHTML = `<button class="no-print action-icon-btn" data-action="addEmptyBar" data-stop="true" title="Add Bar" style="color:#999;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>`;
                grid.appendChild(addBtnWrapper); 
            } else {
                let absoluteBtn = this.$('btn-add-bar');
                if(!absoluteBtn) {
                   absoluteBtn = document.createElement('button');
                   absoluteBtn.id = 'btn-add-bar';
                   absoluteBtn.className = 'no-print';
                   absoluteBtn.setAttribute('data-action', 'addEmptyBar');
                   absoluteBtn.setAttribute('data-stop', 'true');
                   absoluteBtn.title = 'Add Bar';
                   absoluteBtn.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
                   this.shadowRoot.querySelector('.sheet-container').appendChild(absoluteBtn);
                }
                absoluteBtn.style.display = 'flex';
                absoluteBtn.style.left = (this.progressionData.length * 25) + "%";
            }
        } else {
            const oldAddBtn = this.$('btn-add-bar');
            if(oldAddBtn) oldAddBtn.style.display = 'none';
        }
        
        const btnAddTop = this.$('btnAddTop');
        if (btnAddTop) {
            btnAddTop.disabled = !canAddNormally && !isSlotSelected;
            if (isSlotSelected && this.progressionData[this.selectedSlotIndex] && !this.progressionData[this.selectedSlotIndex].isEmpty) {
                btnAddTop.innerText = "Update Chord";
            } else {
                btnAddTop.innerText = "Add to Sheet";
            }
        }
        
        const VF = window.Vex ? (window.Vex.Flow || window.Vex) : null;
        if (VF && VF.Renderer) {
            setTimeout(() => {
                this.progressionData.forEach((item, index) => this.drawChordGraphics(item, index));
            }, 10);
        } else {
            setTimeout(() => this.renderSheet(), 100);
        }
        
        this.detectKey();
        this.updateLeadSheetButtons(); 
    }

    drawChordGraphics(chord, index) {
        let slotWidth;
        if (window.innerWidth <= 768) {
            slotWidth = window.innerWidth * 0.75; 
        } else {
            const containerWidth = this.shadowRoot.querySelector('.sheet-container').clientWidth;
            const sheetWidth = Math.max(containerWidth, 600);
            slotWidth = sheetWidth / 4;
        }
        
        const diagDiv = this.$(`diag-svg-${index}`);
        const tabDiv = this.$(`tab-svg-${index}`);
        if (!diagDiv || !tabDiv) return;

        diagDiv.innerHTML = ''; tabDiv.innerHTML = '';
        
        const VF = window.Vex ? (window.Vex.Flow || window.Vex) : null;
        if (!VF || !VF.Renderer) return;

        const { Renderer, TabStave, Barline } = VF;
        
        const renderer = new Renderer(tabDiv, 1); 
        renderer.resize(slotWidth + 10, 160); 
        const context = renderer.getContext();
        
        const stave = new TabStave(0.5, 0, slotWidth);
        stave.setBegBarType(Barline.type.NONE);
        stave.setEndBarType(Barline.type.NONE);

        if (index === 0) stave.addClef("tab");
        stave.setContext(context).draw();

        const yTop = stave.getYForLine(0);
        const yBot = stave.getYForLine(5);
        const yMid = stave.getYForLine(2.5); 
        const stemBottomY = yMid + 42; 
        
        context.save();
        context.setStrokeStyle("#000");
        context.beginPath(); context.setLineWidth(1);
        context.moveTo(0.5, yTop); context.lineTo(0.5, yBot); context.stroke();
        
        if (index === 3) {
            context.beginPath(); context.setLineWidth(1);
            context.moveTo(slotWidth - 5.5, yTop); context.lineTo(slotWidth - 5.5, yBot); context.stroke();
            context.beginPath(); context.setLineWidth(3); 
            context.moveTo(slotWidth - 1.5, yTop); context.lineTo(slotWidth - 1.5, yBot); context.stroke();
        } else {
            context.beginPath(); context.setLineWidth(1);
            context.moveTo(slotWidth - 0.5, yTop); context.lineTo(slotWidth - 0.5, yBot); context.stroke();
        }
        context.restore();

        if (!chord.isEmpty && window.vexchords) {
            let minFret = 99;
            let hasOpenString = false;
            chord.frets.forEach(f => {
                if (f === 0) hasOpenString = true;
                if (f > 0 && f < minFret) minFret = f;
            });

            let startPosition = (hasOpenString || minFret < 3) ? 1 : minFret;

            const vexParams = chord.frets.map((f, idx) => {
                if (f === 0) return [idx + 1, 0];
                if (f < 0) return [idx + 1, 'x'];
                return [idx + 1, f - startPosition + 1];
            });

            window.vexchords.draw(diagDiv, { chord: vexParams, position: startPosition }, { 
                width: 120, height: 140, strokeColor: '#000', fillColor: '#000' 
            });
        }

        if (chord.pattern && chord.pattern.length > 0) {
            const hasStrums = chord.pattern.some(state => state !== '');
            if (hasStrums) {
                const startX = (index === 0) ? 42 : 24; 
                const endPadding = 10; 
                const availableSpace = slotWidth - startX - endPadding;
                const step = availableSpace / chord.pattern.length;
                const sW = chord.pattern.length === 16 ? 3 : 6;

                chord.pattern.forEach((state, i) => {
                    const x = startX + (i * step);
                    context.save();
                    if (state && state !== '') {
                        const symbol = state === 'd' ? '↓' : (state === 'u' ? '↑' : (state === 'm' ? '✕' : ''));
                        const fontSize = chord.pattern.length === 16 ? "14px" : "16px";
                        context.setFont("Arial", fontSize, "bold");
                        context.setFillStyle("#000");
                        const metrics = context.measureText(symbol);
                        context.fillText(symbol, x - (metrics.width / 2), yTop - 22);
                    }

                    if (chord.pattern.length >= 8) {
                        const groupSize = chord.pattern.length === 16 ? 4 : 2;
                        const isLastInGroup = (i % groupSize) === (groupSize - 1);
                        const isLastInPattern = i === chord.pattern.length - 1;

                        if (!isLastInGroup && !isLastInPattern && state !== '' && chord.pattern[i + 1] !== '') {
                            const beamWidth = step;
                            const beamThickness = 3.5;
                            context.setFillStyle("#000");
                            context.fillRect(x - sW, stemBottomY - beamThickness, beamWidth, beamThickness);
                            if (chord.pattern.length === 16) {
                                context.fillRect(x - sW, stemBottomY - (beamThickness * 2) - 3, beamWidth, beamThickness);
                            }
                        }
                    }

                    context.setStrokeStyle("#000");
                    context.setLineCap("round");
                    
                    if (state === 'd' || state === 'u') {
                        context.setLineWidth(2.8); context.beginPath();
                        context.moveTo(x - sW, yMid + 7); context.lineTo(x + sW, yMid - 7); context.stroke();
                        context.setLineWidth(1.2); context.beginPath();
                        context.moveTo(x - sW, yMid + 7); context.lineTo(x - sW, stemBottomY); context.stroke();
                    } else if (state === 'm') {
                        context.setLineWidth(2); const xSize = 4; context.beginPath();
                        context.moveTo(x - xSize, yMid - xSize); context.lineTo(x + xSize, yMid + xSize);
                        context.moveTo(x + xSize, yMid - xSize); context.lineTo(x - xSize, yMid + xSize); context.stroke();
                        context.setLineWidth(1.2); context.beginPath();
                        context.moveTo(x - sW, yMid); context.lineTo(x - sW, stemBottomY); context.stroke();
                    }
                    context.restore();
                });
            }
        }
    }

    detectKey() {
        const display = this.$('keyDisplay');
        const filledChords = this.progressionData.filter(c => !c.isEmpty);
        if (filledChords.length === 0) { display.innerText = "Key: -"; return; }
        
        const anchorChord = this.progressionData.find(c => !c.isEmpty);
        const anchorName = anchorChord.name;
        let allNotes = [];
        filledChords.forEach(c => {
            const chordInfo = window.Tonal.Chord.get(c.name);
            if (chordInfo && chordInfo.notes) allNotes.push(...chordInfo.notes);
        });
        
        let uniqueNotes = [...new Set(allNotes.map(n => window.Tonal.Note.get(n).pc))];
        const rootMatch = anchorName.match(/^[A-G][#b]?/);
        const firstRoot = rootMatch ? window.Tonal.Note.get(rootMatch[0]).pc : "C";
        const isMinor = anchorName.toLowerCase().includes("m") && !anchorName.toLowerCase().includes("maj");
        const chromatic = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        
        let candidates = [];
        chromatic.forEach(root => {
            ["major", "minor"].forEach(type => {
                const scaleNotes = window.Tonal.Scale.get(`${root} ${type}`).notes;
                const matchCount = uniqueNotes.filter(n => scaleNotes.includes(n)).length;
                let score = (matchCount / (uniqueNotes.length || 1)) * 100;
                if (window.Tonal.Note.get(root).pc === firstRoot) {
                    score += 50;
                    if (isMinor && type === "minor") score += 20;
                    if (!isMinor && type === "major") score += 20;
                }
                candidates.push({ name: `${root} ${type}`, score: score });
            });
        });
        
        candidates.sort((a, b) => b.score - a.score);
        display.innerText = `Key: ${candidates[0].name.replace(/\b\w/g, l => l.toUpperCase())}`;
    }

    handleCopyChord(index) {
        const source = this.progressionData[index];
        if (!source.isEmpty) {
            this.clipboardChordOnly = { name: source.name, frets: [...source.frets] };
            this.showTooltip("Chord copied", "success");
            this.renderSheet(); 
        }
    }

    handlePasteChord(index) {
        if (this.clipboardChordOnly) {
            const target = this.progressionData[index];
            this.progressionData[index] = { 
                ...target, name: this.clipboardChordOnly.name, frets: [...this.clipboardChordOnly.frets], 
                isEmpty: false, resolution: target.resolution || 4, pattern: target.pattern || ['d','','','']
            };
            this.showTooltip("Chord pasted", "success");
            this.renderSheet();
        }
    }

    handleCopyStrum(index) {
        const source = this.progressionData[index];
        if (source.pattern) {
            this.clipboardStrumOnly = { resolution: source.resolution, pattern: [...source.pattern] };
            this.showTooltip("Strumming pattern copied", "success");
            this.renderSheet();
        }
    }

    handlePasteStrum(index) {
        if (this.clipboardStrumOnly) {
            const target = this.progressionData[index];
            this.progressionData[index] = { 
                ...target, resolution: this.clipboardStrumOnly.resolution, pattern: [...this.clipboardStrumOnly.pattern] 
            };
            this.showTooltip("Strumming pattern pasted", "success");
            this.renderSheet();
        }
    }

    updateStrumModalVisibility() {
        const modal = this.$('strum-modal');
        if (this.selectedSlotIndex !== null) {
            const chord = this.progressionData[this.selectedSlotIndex];
            if (!chord) { modal.classList.remove('active'); return; }
            modal.classList.add('active');
            
            if (!chord.pattern) { chord.pattern = ['d', '', '', '']; chord.resolution = 4; }
            this.tempStrumData.pattern = [...chord.pattern];
            this.tempStrumData.resolution = chord.resolution;
            this.$('strum-target-name').innerText = chord.isEmpty ? `Strum: Empty Bar` : `Strum: ${chord.name}`;
            this.$('resSelect').value = this.tempStrumData.resolution;
            
            if (window.innerWidth <= 768) {
                modal.style.position = 'fixed';
                modal.style.top = 'auto';
                modal.style.bottom = '20px';
                modal.style.left = '5vw';
                modal.style.width = '90vw';
                modal.style.zIndex = '6000';
                modal.style.transform = 'none';
            } else {
                modal.style.position = 'absolute';
                modal.style.bottom = 'auto'; 
                modal.style.transform = 'none';
                modal.style.zIndex = '1000';
                modal.style.width = '380px';
                const slots = this.$$('.progression-slot');
                if (slots[this.selectedSlotIndex]) {
                    const slot = slots[this.selectedSlotIndex];
                    const slotRect = slot.getBoundingClientRect();
                    const card = this.shadowRoot.querySelector('.app-card');
                    const cardRect = card.getBoundingClientRect();
                    let targetTop = slotRect.top - cardRect.top;
                    let targetLeft = (slotRect.right - cardRect.left) + 15; 
                    if (targetLeft + 380 > cardRect.width) {
                        targetLeft = (slotRect.left - cardRect.left) - 395;
                        if (targetLeft < 0) targetLeft = cardRect.width - 380; 
                    }
                    modal.style.top = targetTop + "px";
                    modal.style.left = targetLeft + "px";
                }
            }
            this.renderStrumGrid();
        } else {
            modal.classList.remove('active');
        }
    }

    makeDraggable(el) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const handle = this.$("strum-handle");
        handle.onmousedown = (e) => {
            e.preventDefault();
            if (e.target.closest('.close-modal-btn')) return; 
            pos3 = e.clientX;
            pos4 = e.clientY;
            window.onmouseup = () => { window.onmouseup = null; window.onmousemove = null; };
            window.onmousemove = (e) => {
                e.preventDefault();
                pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
                pos3 = e.clientX; pos4 = e.clientY;
                el.style.top = (el.offsetTop - pos2) + "px";
                el.style.left = (el.offsetLeft - pos1) + "px";
            };
        };
    }

    setTool(tool) {
        this.activeBrush = tool;
        this.$$('.tool-btn').forEach(b => b.classList.remove('active'));
        const id = tool === '' ? 'tool-erase' : `tool-${tool}`;
        this.$(id).classList.add('active');
    }

    applyBrush(idx) {
        if (this.selectedSlotIndex === null) return;
        this.tempStrumData.pattern[idx] = this.activeBrush; 
        const grid = this.$('strum-grid');
        const cell = grid.children[idx];
        if (cell) {
            let symbol = '';
            if (this.activeBrush === 'd') symbol = '&darr;';
            if (this.activeBrush === 'u') symbol = '&uarr;';
            if (this.activeBrush === 'm') symbol = 'X';
            cell.className = `strum-cell state-${this.activeBrush}`;
            cell.innerHTML = symbol;
        }
    }

    renderStrumGrid() {
        if (this.selectedSlotIndex === null) return;
        const grid = this.$('strum-grid');
        grid.innerHTML = '';

        grid.ontouchstart = null; grid.ontouchmove = null;
        grid.ontouchend = null; grid.ontouchcancel = null;

        const paintAtPoint = (x, y) => {
            const el = this.shadowRoot.elementFromPoint(x, y);
            if (el && el.classList.contains('strum-cell')) {
                const idx = parseInt(el.getAttribute('data-idx'));
                if(!isNaN(idx)) this.applyBrush(idx);
            }
        };

        grid.ontouchstart = (e) => {
            e.preventDefault();
            this.isPaintingStrums = true;
            const touch = e.touches ? e.touches[0] : e;
            paintAtPoint(touch.clientX, touch.clientY);
        };

        grid.addEventListener('touchmove', (e) => {
            if (!this.isPaintingStrums) return;
            e.preventDefault();
            const touch = e.touches ? e.touches[0] : e;
            paintAtPoint(touch.clientX, touch.clientY);
        }, { passive: false });

        const stopPainting = () => { this.isPaintingStrums = false; };
        grid.ontouchend = stopPainting;
        grid.ontouchcancel = stopPainting;

        this.tempStrumData.pattern.forEach((state, idx) => {
            const cell = document.createElement('div');
            let symbol = '';
            if (state === 'd') symbol = '&darr;';
            if (state === 'u') symbol = '&uarr;';
            if (state === 'm') symbol = 'X';
            
            cell.className = `strum-cell state-${state}`;
            cell.setAttribute('data-idx', idx); 
            cell.innerHTML = symbol;
            
            cell.onmousedown = (e) => { e.preventDefault(); this.isPaintingStrums = true; this.applyBrush(idx); };
            cell.onmouseenter = (e) => { if (this.isPaintingStrums) this.applyBrush(idx); };
            
            grid.appendChild(cell);
        });
    }

    clearStrumPattern() {
        if (this.selectedSlotIndex === null) return;
        this.tempStrumData.pattern = Array(this.tempStrumData.resolution).fill('');
        this.renderStrumGrid();
    }

    changeResolution(val) {
        if (this.selectedSlotIndex === null) return;
        const newRes = parseInt(val);
        const oldRes = this.tempStrumData.resolution;
        if (oldRes === newRes) return;
        let newPattern = Array(newRes).fill('');
        for(let i = 0; i < Math.max(oldRes, newRes); i++) {
            if (newRes > oldRes) {
                let targetIdx = Math.floor(i * (newRes / oldRes));
                if (i < oldRes) newPattern[targetIdx] = this.tempStrumData.pattern[i];
            } else {
                let sourceIdx = Math.floor(i * (oldRes / newRes));
                if (i < newRes) newPattern[i] = this.tempStrumData.pattern[sourceIdx];
            }
        }
        this.tempStrumData.resolution = newRes;
        this.tempStrumData.pattern = newPattern;
        this.renderStrumGrid();
    }

    insertStrumming() {
        if (this.selectedSlotIndex === null) return;
        this.progressionData[this.selectedSlotIndex].pattern = [...this.tempStrumData.pattern];
        this.progressionData[this.selectedSlotIndex].resolution = this.tempStrumData.resolution;
        this.renderSheet();
    }

    showTooltip(message, type = "default") {
        const x = this.$("snackbar");
        const txt = this.$("snackbar-text");
        txt.innerText = message || "Action recorded";
        x.classList.remove("warning", "success", "show");
        if (type === "warning") x.classList.add("warning");
        if (type === "success") x.classList.add("success");
        void x.offsetWidth; 
        x.classList.add("show");
        clearTimeout(this.tooltipTimeout);
        this.tooltipTimeout = setTimeout(() => { x.classList.remove("show"); }, 3000);
    }

    showConfirmModal(message, onConfirm) {
        const modal = this.$('custom-confirm-modal');
        const msgEl = this.$('confirm-modal-msg');
        const btnOk = this.$('confirm-btn-ok');
        msgEl.innerText = message;
        modal.style.display = 'flex';
        btnOk.onclick = () => { modal.style.display = 'none'; if(onConfirm) onConfirm(); };
    }

    saveProgressionToFile() {
        const hasAtLeastOneChord = this.progressionData.some(chord => !chord.isEmpty);
        if (!hasAtLeastOneChord) { this.showTooltip("Add at least one chord to save", "warning"); return; }
        const currentTitle = this.$('songTitleDisplay').innerText.trim();
        if (currentTitle === "SONG TITLE" || !this.titleHasBeenEdited) {
            this.showTooltip("Rename 'SONG TITLE' before saving", "warning");
            const titleEl = this.$('songTitleDisplay');
            titleEl.style.color = '#db3069';
            setTimeout(() => titleEl.style.color = '', 1500);
            return;
        }
        const existingSession = this.cloudBankData.find(s => s.title.toLowerCase() === currentTitle.toLowerCase());
        if (existingSession) {
            this.showConfirmModal(`A progression named "${currentTitle}" already exists.\n\nDo you want to overwrite it?`, 
                () => { this.proceedWithCloudSave(existingSession.id, currentTitle); });
        } else {
            this.proceedWithCloudSave(null, currentTitle);
        }
    }

    async proceedWithCloudSave(existingId, currentTitle) {
        if (!this.supabaseClient) { this.showTooltip("Supabase unlinked.", "warning"); return; }
        const currentKey = this.$('keyDisplay').innerText.replace('Key: ', '').trim();
        let currentBpmStr = this.$('bpm-value').innerText.trim();
        const currentBpm = currentBpmStr ? parseInt(currentBpmStr) : null;
        const exportBundle = {
            title: currentTitle, song_key: currentKey, bpm: currentBpm,
            payload: this.progressionData.map(c => c.isEmpty ? c : { name: c.name, frets: c.frets, resolution: c.resolution, pattern: c.pattern, isEmpty: c.isEmpty })
        };
        try {
            this.showTooltip(existingId ? "Updating Cloud Session..." : "Saving to Vault...", "default");
            let dbError;
            if (existingId) {
                const { error } = await this.supabaseClient.from('progressions').update(exportBundle).eq('id', existingId);
                dbError = error;
            } else {
                const { error } = await this.supabaseClient.from('progressions').insert([exportBundle]);
                dbError = error;
            }
            if (dbError) throw dbError;
            this.showTooltip("Saved to Vault", "success");
            this.requestCloudSessions(); 
        } catch (err) {
            console.error("DB Save Error:", err);
            this.showTooltip("Error saving to cloud", "warning");
        }
    }

    handleSort(colName) {
        if (this.currentSortCol === colName) { this.currentSortAsc = !this.currentSortAsc; } 
        else {
            this.currentSortCol = colName;
            this.currentSortAsc = (colName !== 'lastModified' && colName !== 'bpm');
        }
        this.updateSortHeaderUI();
        this.renderCloudGallery();
    }

    updateSortHeaderUI() {
        this.$$('.sort-header').forEach(header => {
            header.classList.remove('active', 'asc', 'desc');
            const col = header.getAttribute('data-col');
            const arrowWrap = header.querySelector('.sort-arrow-wrap');
            if (col === this.currentSortCol) {
                header.classList.add('active', this.currentSortAsc ? 'asc' : 'desc');
                arrowWrap.innerHTML = `<svg class="sort-arrow ${this.currentSortAsc ? 'asc' : 'desc'}" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg>`;
            } else {
                arrowWrap.innerHTML = `<svg class="sort-arrow inactive" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg>`;
            }
        });
    }

    getSortedBankData() {
        return [...this.cloudBankData].sort((a, b) => {
            let valA = a[this.currentSortCol]; let valB = b[this.currentSortCol];
            if (this.currentSortCol === 'title' || this.currentSortCol === 'key') {
                valA = (valA || '').toString().toLowerCase(); valB = (valB || '').toString().toLowerCase();
            } else if (this.currentSortCol === 'lastModified') {
                valA = valA ? new Date(valA).getTime() : 0; valB = valB ? new Date(valB).getTime() : 0;
            } else if (this.currentSortCol === 'bpm') {
                valA = valA ? parseInt(valA) : 0; valB = valB ? parseInt(valB) : 0;
            }
            if (valA < valB) return this.currentSortAsc ? -1 : 1;
            if (valA > valB) return this.currentSortAsc ? 1 : -1;
            return 0;
        });
    }

    toggleAllCheckboxes(master) {
        this.$$('.bank-checkbox').forEach(cb => cb.checked = master.checked);
        this.updateSelectionState();
    }

    renderCloudGallery() {
        const container = this.$('file-gallery');
        if (!container) return;
        container.innerHTML = '';
        if (this.cloudBankData.length === 0) {
            container.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">Your saved progressions will appear here.</div>';
            return;
        }

        this.getSortedBankData().forEach(session => {
            const row = document.createElement('div');
            row.className = 'bank-row';
            const dateStr = session.lastModified ? session.lastModified.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' }) : '--';

            row.innerHTML = `
                <div class="col-check" data-stop="true"><input type="checkbox" class="bank-checkbox" data-id="${session.id}"></div>
                <div class="col-name title-edit-wrapper" id="title-wrapper-${session.id}" data-stop="true">
                    <span class="bank-title-text" data-action="loadProgressionById" data-param="${session.id}">${session.title || 'Untitled'}</span>
                    <button class="inline-edit-btn" data-action="startInlineRename" data-param="${session.id}" data-stop="true" title="Rename">
                        <svg class="edit-icon" width="14" height="14" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    </button>
                </div>
                <div class="col-key" data-action="loadProgressionById" data-param="${session.id}">${session.key || '--'}</div>
                <div class="col-bpm" data-action="loadProgressionById" data-param="${session.id}">${session.bpm || '--'}</div>
                <div class="col-modified" data-action="loadProgressionById" data-param="${session.id}">${dateStr}</div>
                <button class="row-delete-btn" data-action="openDeleteModal" data-param="${session.id}" data-stop="true" title="Delete Progression">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y1="17"></line><line x1="14" y1="11" x2="14" y1="17"></line></svg>
                </button>
            `;
            container.appendChild(row);
        });

        this.$$('.bank-checkbox').forEach(cb => {
            if(this.selectedProgressionIds.has(cb.dataset.id)) cb.checked = true;
        });
        this.updateSelectionState();
    }

    loadProgressionById(id) {
        const session = this.cloudBankData.find(s => s.id == id);
        if (session) this.loadProgression(session);
    }

    startInlineRename(id, event) {
        const wrapper = this.$(`title-wrapper-${id}`);
        const currentTitle = wrapper.querySelector('.bank-title-text').innerText;
        wrapper.innerHTML = `<input type="text" class="col-name-input" id="rename-input-${id}" value="${currentTitle}">`;
        const input = this.$(`rename-input-${id}`);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        
        const saveRename = async () => {
            const newTitle = input.value.trim() || 'Untitled';
            const session = this.cloudBankData.find(s => s.id == id);
            if(session) session.title = newTitle;
            this.renderCloudGallery(); 
            try {
                if(!this.supabaseClient) throw new Error("No DB");
                const { error } = await this.supabaseClient.from('progressions').update({title: newTitle}).eq('id', id);
                if (error) throw error;
                this.showTooltip("Renamed successfully", "success");
            } catch (err) {
                console.error("Rename Error:", err);
                this.showTooltip("Error renaming session", "warning");
                this.requestCloudSessions();
            }
        };
        input.onclick = (e) => e.stopPropagation();
        input.onblur = saveRename;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') this.renderCloudGallery();
        };
    }

    loadProgression(content) {
        if (!content || !content.chords) return;
        this.progressionData = content.chords;
        this.$('songTitleDisplay').innerText = content.title || "SONG TITLE";
        this.$('keyDisplay').innerText = `Key: ${content.key || '-'}`;
        const bpmValueEl = this.$('bpm-value');
        bpmValueEl.innerText = content.bpm ? content.bpm : "";
        
        this.titleHasBeenEdited = true;
        this.lastUserTitle = content.title || "SONG TITLE";
        this.deselectAllSlots();
        this.renderSheet();
        this.showTooltip(`Loaded: ${content.title}`, "success");
    }

    updateSelectionState() {
        const checkboxes = this.$$('.bank-checkbox:checked');
        this.selectedProgressionIds = new Set(Array.from(checkboxes).map(cb => cb.dataset.id));
        const deleteBtn = this.$('btn-delete-selected');
        const exportBtn = this.$('export-pdf-btn');
        const hasSelection = this.selectedProgressionIds.size > 0;
        
        if (deleteBtn) {
            deleteBtn.disabled = !hasSelection;
            deleteBtn.classList.replace(hasSelection ? 'btn-secondary' : 'btn-primary', hasSelection ? 'btn-primary' : 'btn-secondary');
        }
        if (exportBtn) {
            exportBtn.disabled = !hasSelection;
            exportBtn.classList.replace(hasSelection ? 'btn-secondary' : 'btn-primary', hasSelection ? 'btn-primary' : 'btn-secondary');
        }
    }

    openDeleteModal(id, event) {
        this.pendingDeleteId = id;
        const text = id 
            ? "This will permanently delete your progression. Please confirm that you want to delete it."
            : `This will permanently delete ${this.selectedProgressionIds.size} selected progressions. Please confirm.`;
        this.$('delete-confirm-text').innerText = text;
        this.$('delete-confirm-modal').style.display = 'flex';
    }

    closeDeleteModal() {
        this.$('delete-confirm-modal').style.display = 'none';
        this.pendingDeleteId = null;
    }

    async confirmDelete() {
        if (!this.supabaseClient) return;
        try {
            if (this.pendingDeleteId) {
                await this.supabaseClient.from('progressions').delete().eq('id', this.pendingDeleteId);
            } else {
                await this.supabaseClient.from('progressions').delete().in('id', Array.from(this.selectedProgressionIds));
            }
            this.closeDeleteModal();
            this.showTooltip("Deleted successfully", "success");
            this.requestCloudSessions(); 
            this.selectedProgressionIds.clear();
            this.updateSelectionState();
        } catch (err) {
            console.error("Delete Error:", err);
            this.showTooltip("Delete failed", "warning");
        }
    }

    // ========================================== //
    // --- PDF EXPORT ENGINE ---                  //
    // ========================================== //
    drawChordGraphicsForPDF_Direct(chord, diagId, tabId, idx, total) {
        const diagDiv = this.$(diagId);
        const tabDiv = this.$(tabId);

        if (!chord.isEmpty && diagDiv && window.vexchords) {
            let minFret = 99;
            let hasOpenString = false;
            chord.frets.forEach(f => { if (f === 0) hasOpenString = true; if (f > 0 && f < minFret) minFret = f; });
            let startPosition = (hasOpenString || minFret < 3) ? 1 : minFret;
            const vexParams = chord.frets.map((f, i) => {
                if (f === 0) return [i + 1, 0];
                if (f < 0) return [i + 1, 'x'];
                return [i + 1, f - startPosition + 1];
            });
            window.vexchords.draw(diagDiv, { chord: vexParams, position: startPosition }, { width: 100, height: 120, strokeColor: '#000000', fillColor: '#000000', labelColor: '#000000' });
        }
        
        if (!tabDiv) return;
        tabDiv.innerHTML = ''; 
        
        const VF = window.Vex ? (window.Vex.Flow || window.Vex) : null;
        if (!VF || !VF.Renderer) return;
        const { Renderer, TabStave, Barline } = VF;
        
        const slotWidth = 182; 
        const renderer = new Renderer(tabDiv, 1); 
        renderer.resize(slotWidth, 160); 
        const context = renderer.getContext();
        const stave = new TabStave(0, 0, slotWidth);
        stave.setBegBarType(Barline.type.NONE); stave.setEndBarType(Barline.type.NONE);
        if (idx === 0) stave.addClef("tab");
        stave.setContext(context).draw();

        const yTop = stave.getYForLine(0); const yBot = stave.getYForLine(5); const yMid = stave.getYForLine(2.5); const stemBottomY = yMid + 42; 

        context.save(); context.setStrokeStyle("#000"); context.beginPath(); context.setLineWidth(1);
        context.moveTo(0.5, yTop); context.lineTo(0.5, yBot); context.stroke();
        if (idx === total - 1) {
            context.beginPath(); context.setLineWidth(1); context.moveTo(slotWidth - 5.5, yTop); context.lineTo(slotWidth - 5.5, yBot); context.stroke();
            context.beginPath(); context.setLineWidth(3); context.moveTo(slotWidth - 1.5, yTop); context.lineTo(slotWidth - 1.5, yBot); context.stroke();
        } else {
            context.beginPath(); context.setLineWidth(1); context.moveTo(slotWidth - 0.5, yTop); context.lineTo(slotWidth - 0.5, yBot); context.stroke();
        }
        context.restore();

        if (chord.pattern && chord.pattern.length > 0) {
            const hasStrums = chord.pattern.some(state => state !== '');
            if (hasStrums) {
                const startX = (idx === 0) ? 42 : 24; const endPadding = 10; const availableSpace = slotWidth - startX - endPadding;
                const step = availableSpace / chord.pattern.length; const sW = chord.pattern.length === 16 ? 3 : 6;
                chord.pattern.forEach((state, i) => {
                    const x = startX + (i * step); context.save();
                    if (state && state !== '') {
                        const symbol = state === 'd' ? '↓' : (state === 'u' ? '↑' : (state === 'm' ? '✕' : ''));
                        context.setFont("Arial", chord.pattern.length === 16 ? "14px" : "16px", "bold"); context.setFillStyle("#000");
                        context.fillText(symbol, x - (context.measureText(symbol).width / 2), yTop - 22);
                    }
                    if (chord.pattern.length >= 8) {
                        const isLastInGroup = (i % (chord.pattern.length === 16 ? 4 : 2)) === ((chord.pattern.length === 16 ? 4 : 2) - 1);
                        if (!isLastInGroup && i !== chord.pattern.length - 1 && state !== '' && chord.pattern[i + 1] !== '') {
                            context.setFillStyle("#000"); context.fillRect(x - sW, stemBottomY - 3.5, step, 3.5);
                            if (chord.pattern.length === 16) context.fillRect(x - sW, stemBottomY - 7 - 3, step, 3.5);
                        }
                    }
                    context.setStrokeStyle("#000"); context.setLineCap("round");
                    if (state === 'd' || state === 'u') {
                        context.setLineWidth(2.8); context.beginPath(); context.moveTo(x - sW, yMid + 7); context.lineTo(x + sW, yMid - 7); context.stroke();
                        context.setLineWidth(1.2); context.beginPath(); context.moveTo(x - sW, yMid + 7); context.lineTo(x - sW, stemBottomY); context.stroke();
                    } else if (state === 'm') {
                        context.setLineWidth(2); context.beginPath();
                        context.moveTo(x - 4, yMid - 4); context.lineTo(x + 4, yMid + 4); context.moveTo(x + 4, yMid - 4); context.lineTo(x - 4, yMid + 4); context.stroke();
                        context.setLineWidth(1.2); context.beginPath(); context.moveTo(x - sW, yMid); context.lineTo(x - sW, stemBottomY); context.stroke();
                    }
                    context.restore();
                });
            }
        }
    }

    async exportSelectedToPDF() {
        if (this.selectedProgressionIds.size === 0) return;
        const staging = this.$('pdf-pages-staging');
        staging.innerHTML = '<style>#pdf-pages-staging svg { margin-bottom: 20px; }</style>'; 
        this.$('pdf-preview-modal').style.display = 'block';

        const createPdfPage = () => {
            const page = document.createElement('div');
            page.style.cssText = `background: white !important; width: 850px; height: 1060px; padding: 100px 50px 0px 50px; margin: 0 auto 40px auto; color: black !important; display: flex; flex-direction: column; gap: 20px; overflow: hidden; position: relative; border: none; box-sizing: border-box; box-shadow: 0 10px 30px rgba(0,0,0,0.5);`;
            return page;
        };

        let currentPage = createPdfPage();
        staging.appendChild(currentPage);
        let count = 0;

        for (const sessionID of this.selectedProgressionIds) {
            const data = this.cloudBankData.find(item => item.id == sessionID);
            if (!data) continue;
            const safeID = String(sessionID).replace(/[^a-z0-9]/gi, '-');

            const wrapper = document.createElement('div');
            wrapper.style.cssText = "margin-bottom: 20px; color: black; width: 100%; font-family: 'Outfit', sans-serif;";
            
            const header = document.createElement('div');
            header.style.marginBottom = "15px";
            header.innerHTML = `<h2 style="font-size: 1.6rem; font-weight: 800; margin: 0 0 5px 0; text-transform: uppercase;">${data.title}</h2>
                <div style="font-size: 1rem; color: #444; font-family: 'Cormorant Garamond', serif; font-style: italic; font-weight: 700;">
                    <span>Key: ${data.key || '-'}</span>${data.bpm ? `<span style="margin-left: 20px;">BPM: ${data.bpm}</span>` : ''}
                </div>`;
            wrapper.appendChild(header); 
            
            const gridContainer = document.createElement('div');
            gridContainer.id = `pdf-grid-${safeID}`;
            gridContainer.style.cssText = "display: grid; grid-template-columns: repeat(4, 182px); grid-gap: 0; width: 728px; margin: 0 auto;";
            wrapper.appendChild(gridContainer);

            if (count >= 2) { 
                currentPage = createPdfPage(); staging.appendChild(currentPage); count = 0;
            }
            currentPage.appendChild(wrapper); count++;

            data.chords.forEach((chord, idx) => {
                const slot = document.createElement('div');
                slot.style.cssText = "text-align: center; padding: 0; margin: 0; overflow: hidden;";
                slot.innerHTML = `
                    <div style="font-weight: 800; font-size: 1.2rem; margin-bottom: 5px; height: 25px; min-height: 25px; text-align: center;">${chord.isEmpty ? '' : chord.name}</div>
                    <div id="diag-${safeID}-${idx}" style="height: 140px; min-height: 140px; margin-bottom: -10px; display: flex; justify-content: center; width: 100%;"></div>
                    <div id="tab-${safeID}-${idx}" style="width: 100%;"></div>
                `;
                gridContainer.appendChild(slot);
                this.drawChordGraphicsForPDF_Direct(chord, `diag-${safeID}-${idx}`, `tab-${safeID}-${idx}`, idx, data.chords.length);
            });
        }
    }

    triggerFinalPDF() {
        const element = this.$('pdf-pages-staging');
        const snackbar = this.$("snackbar");
        const statusText = this.$("snackbar-text");
        const progressBar = this.$("export-progress-bar");

        statusText.innerText = "Generating PDF...";
        progressBar.style.width = "0%";
        snackbar.className = "show export-mode success";

        let progress = 0;
        const progressInterval = setInterval(() => {
            if (progress < 90) { progress += Math.random() * 15; if (progress > 90) progress = 90; progressBar.style.width = `${progress}%`; }
        }, 300);

        setTimeout(() => {
            const exportWrapper = document.createElement('div');
            exportWrapper.style.cssText = "position:absolute; left:-9999px; top:0; width: 100%; z-index:-1;";
            this.shadowRoot.querySelectorAll('style').forEach(s => exportWrapper.appendChild(s.cloneNode(true)));
            exportWrapper.appendChild(element.cloneNode(true));
            document.body.appendChild(exportWrapper);

            const opt = {
                margin: 0, filename: `Phonogram_Tablature.pdf`, image: { type: 'jpeg', quality: 1.0 },
                pagebreak: { mode: ['css', 'legacy'] },
                html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollY: 0, width: 850 },
                jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
            };

            window.html2pdf().set(opt).from(exportWrapper).save().then(() => {
                clearInterval(progressInterval);
                progressBar.style.width = "100%"; statusText.innerText = "Export Complete";
                document.body.removeChild(exportWrapper);
                setTimeout(() => snackbar.classList.remove("show", "export-mode"), 1500);
            }).catch(err => {
                clearInterval(progressInterval);
                statusText.innerText = "Export Failed"; snackbar.classList.add("warning");
                document.body.removeChild(exportWrapper);
                console.error("PDF Error:", err);
            });
        }, 500); 
    }

    closePreview() {
        const overlay = this.$('pdf-preview-modal');
        if (overlay) { overlay.style.display = 'none'; this.$('pdf-pages-staging').innerHTML = ''; }
    }
}

customElements.define('phonogram-tablature', PhonogramTablature);
