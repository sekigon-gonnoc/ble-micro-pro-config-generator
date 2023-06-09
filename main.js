
const keyboardsAPI = `https://api.qmk.fm/v1/keyboards`;
const PIN_TABLE = {
    'D3': 1, 'D2': 2, 'D1': 5, 'D0': 6, 'D4': 7, 'C6': 8, 'D7': 9, 'E6': 10, 'B4': 11,
    'B5': 12, 'B6': 13, 'B2': 14, 'B3': 15, 'B1': 16, 'F7': 17, 'F6': 18, 'F5': 19, 'F4': 20
};

function getKeyboardList() {
    return fetch(keyboardsAPI).then(res => res.json());
}

async function getKeyboard(name) {
    return await fetch(`https://keyboards.qmk.fm/v1/keyboards/${name}/info.json`).then(
        res => res.json()
    ).then(j => j.keyboards[name]);
}

function getDiodeDir(str) {
    switch (str) {
        case "COL2ROW":
            return 0;
        case "ROW2COL":
            return 1;
        default:
            return 0;
    }
}

function overrideRightConfig(info, config_left) {
    let config_right = JSON.parse(JSON.stringify(config_left));
    config_right.config.mode = "SPLIT_SLAVE";
    config_right.config.matrix.is_left_hand = 0;

    if (info.split?.enabled && info.split?.matrix_pins?.right) {
        console.log("override matrix_pins for config_right");
        let row, col;
        if (info.split?.matrix_pins?.right.direct) {
            row = [0];
            col = info.split.matrix_pins.right.direct.flat(Infinity).map(r => (r == null) ? 0 : PIN_TABLE[r]);
            console.log(info.split.matrix_pins);
        } else {
            row = info.split.matrix_pins.right.rows.map(r => (r == null) ? 0 : PIN_TABLE[r]);
            col = info.split.matrix_pins.right.cols.map(r => (r == null) ? 0 : PIN_TABLE[r]);
        }
        config_right.config.matrix.row_pins = row;
        config_right.config.matrix.col_pins = col;
    }

    return config_right;
}

function parseInfoJson(info, layoutName) {
    console.log(info);

    let row, col;

    if (info.matrix_pins.direct) {
        row = [0];
        col = info.matrix_pins.direct.flat(Infinity).map(r => (r == null) ? 0 : PIN_TABLE[r]);
        console.log(info.matrix_pins);
    } else {
        row = info.matrix_pins.rows.map(r => (r == null) ? 0 : PIN_TABLE[r]);
        col = info.matrix_pins.cols.map(r => (r == null) ? 0 : PIN_TABLE[r]);
    }
    console.log(row, col);

    if (row.some(n => n == null) || col.some(n => n == null)) {
        console.log('not pro micro');
        throw Error("This keyboard may not use Pro Micro");
    }

    const infoLayout = info.layouts[layoutName].layout;
    console.log(infoLayout);
    row_size = Math.max(...infoLayout.map(m => m.matrix[0])) + 1;
    col_size = Math.max(...infoLayout.map(m => m.matrix[1])) + 1;
    let layout = []
    for (let y = Math.min(...infoLayout.map(l => l.y)); y <= Math.max(...infoLayout.map(l => l.y)); y++) {
        let r = infoLayout.filter(l => l.y >= y && l.y < y + 1).
            sort((a, b) => a.x - b.x).
            map(l => l.matrix[0] * col_size + l.matrix[1] + 1)
        if (r.length > 0) {
            layout.push(...r);
            layout.push(0);
        }
    }
    // remove last 0
    layout.pop();
    console.log(layout);

    const diodeDir = getDiodeDir(info.diode_direction);

    const ledPin = (info.rgblight?.pin) ? PIN_TABLE[info.rgblight.pin] : 255;
    const ledNum = info.rgblight?.led_count ?? 0;

    let config_left = {
        config: {
            version: 2,
            device_info: {
                vid: info.usb.vid,
                pid: info.usb.pid, name: info.keyboard_name,
                manufacture: info.manufacturer ?? "", description: ""
            },
            matrix: {
                rows: row.length,
                cols: col.length,
                device_rows: row.length,
                device_cols: col.length,
                debounce: 1,
                is_left_hand: 1,
                diode_direction: diodeDir,
                row_pins: row,
                col_pins: col,
                layout: layout,
            },
            mode: "SINGLE",
            startup: 1,
            peripheral: { max_interval: 30, min_interval: 30, slave_latency: 16 },
            central: { max_interval: 30, min_interval: 30, slave_latency: 0 },
            led: { pin: ledPin, num: ledNum },
            keymap: { locale: "US", use_ascii: 0 },
            reserved: [0, 0, 0, 0, 0, 0, 0, 0],
        }
    };

    if (!info.matrix_pins.direct && !info.split?.enabled && config_left.config.matrix.rows * config_left.config.matrix.cols < infoLayout.length) {
        // may be row2col2row or col2row2col
        config_left.config.matrix.diode_direction += 4;
    }

    const baseConfig = JSON.stringify(config_left);

    if (!info.split?.enabled) {
        return { 'default': baseConfig };
    }

    config_left.config.mode = "SPLIT_MASTER";
    const config_right = overrideRightConfig(info, config_left);

    if (config_left.config.matrix.diode_direction == 0) {
        config_left.config.matrix.rows += config_right.config.matrix.device_rows;
        config_right.config.matrix.rows = config_left.config.matrix.rows;
    }
    else if (config_left.config.matrix.diode_direction == 1) {
        config_left.config.matrix.cols += config_right.config.matrix.device_cols;
        config_right.config.matrix.cols = config_left.config.matrix.cols;
    }

    const masterConfig = JSON.stringify(config_left);
    const slaveConfig = JSON.stringify(config_right);

    if (config_left.config.matrix.row_pins.some(k => (k == 5 || k == 6))
        || config_left.config.matrix.col_pins.some(k => (k == 5 || k == 6))) {
        return { 'master': masterConfig, 'slave': slaveConfig };
    }

    config_left = JSON.parse(baseConfig);
    config_left.config.matrix.row_pins = [...config_left.config.matrix.row_pins, ...config_right.config.matrix.row_pins];
    config_left.config.matrix.col_pins = [...config_left.config.matrix.col_pins, ...config_right.config.matrix.col_pins];
    config_left.config.matrix.diode_direction += 2;
    const lpmeConfig = JSON.stringify(config_left);

    console.log(masterConfig);
    console.log(slaveConfig);
    console.log(lpmeConfig);

    return { 'master': masterConfig, 'slave': slaveConfig, 'lpme': lpmeConfig };
}

const keyboardList = document.getElementById('keyboard-list');
const layoutList = document.getElementById('layout-list');
const search = document.getElementById('search');
const convert = document.getElementById('convert');
const infoJson = document.getElementById('info');
const results = document.getElementById('results');

function updateList(keyboards) {
    keyboardList.innerHTML = ""
    keyboards.forEach(k => keyboardList.appendChild(new Option(k, k)));
}

function updateLayouts() {
    layoutList.innerHTML = "";
    let info = JSON.parse(infoJson.value);
    Object.keys(info.layouts).forEach(
        k => layoutList.appendChild(new Option(k, k, false, false))
    );
}

async function updateInfo() {
    layoutList.innerHTML = "";
    infoJson.value = "";

    try {
        const info = await getKeyboard(keyboardList.value);
        infoJson.value = JSON.stringify(info);
        updateLayouts();
    } catch (error) {
        console.log('failed to parse keyboard', error)
    }
}


async function main() {
    keyboardList.addEventListener('change', e => {
        updateInfo();
    });

    infoJson.addEventListener('input', e => {
        updateLayouts();
    });

    const keyboards = await getKeyboardList();
    updateList(keyboards);
    search.addEventListener('input', e => {
        let first = true;
        Array.from(document.querySelectorAll('#keyboard-list > option')).forEach(k => {
            const valid = k.text.includes(e.target.value)
            k.style.display = valid ? "" : "none";
            if (first && valid) {
                if (keyboardList.value != k.value) {
                    keyboardList.value = k.value;
                    updateInfo();
                }
                k.selected = true;
                first = false;
            } else {
                k.selected = false;
            }
        });
    });
    convert.addEventListener('click', (e => {
        results.innerHTML = "";
        try {
            let configs = parseInfoJson(JSON.parse(infoJson.value), layoutList.value);
            Object.keys(configs).forEach(k => {
                let p = document.createElement('p');
                let h3 = document.createElement('h3');
                let b = document.createElement('button');
                h3.innerText = k;
                p.innerText = configs[k].replace(/\"layout\".*?]/gi, (s) => s.replaceAll(',0,', ',0,\n'));
                b.innerText = 'copy';
                b.style = 'margin: 0.5em';
                b.addEventListener('click', e => {
                    navigator.clipboard.writeText(p.innerText);
                });
                h3.appendChild(b);
                results.appendChild(h3);
                results.appendChild(p);
            });
        } catch (error) {
            results.innerText = `Failed to Convert
            ${error}`;

        }
    }));
}

main();
