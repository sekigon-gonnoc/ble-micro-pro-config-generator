
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

function parseInfoJson(info, layoutName) {
    console.log(info);
    const row = info.matrix_pins.rows.map(r => PIN_TABLE[r]);
    const col = info.matrix_pins.cols.map(r => PIN_TABLE[r]);
    console.log(row, col);

    if(row.some(n=>n==null) || col.some(n=>n==null)){
        console.log('not pro micro');
        throw Error("This keyboard may not use Pro Micro");
    }

    const infoLayout = info.layouts[layoutName].layout;
    console.log(infoLayout);
    let layout = []
    for (let y = Math.min(...infoLayout.map(l => l.y)); y <= Math.max(...infoLayout.map(l => l.y)); y++) {
        let r = infoLayout.filter(l => l.y >= y && l.y < y + 1).
            sort((a, b) => a.x - b.x).
            map(l => l.matrix[0] * info.matrix_size.cols + l.matrix[1] + 1)
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

    let config = {
        config: {
            version: 2,
            device_info: { vid: info.usb.vid,
                pid: info.usb.pid, name: info.keyboard_name,
                manufacture: info.manufacturer ?? "", description: ""
            },
            matrix: {
                row: info.matrix_size.rows,
                col: info.matrix_size.cols,
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
            peripheral: { max_interval: 30, min_interval: 30, slave_latency: 7 },
            central: { max_interval: 30, min_interval: 30, slave_latency: 0 },
            led: { pin: ledPin, num: ledNum },
            keymap: { locale: "US", use_ascii: 0 },
            reserved: [0, 0, 0, 0, 0, 0, 0, 0],
        }
    };

    if (!info.split?.enabled && config.config.matrix.row != config.config.matrix.col) {
        // may be row2col2row or col2row2col
        config.config.matrix.diode_direction += 4;
    }

    const baseConfig = JSON.stringify(config);

    if (!info.split?.enabled) {
        return { 'default': baseConfig };
    }

    config.config.mode = "SPLIT_MASTER";
    const masterConfig = JSON.stringify(config);

    config.config.mode = "SPLIT_SLAVE";
    config.config.matrix.is_left_hand = 0;
    const slaveConfig = JSON.stringify(config);

    if (config.config.matrix.row_pins.some(k => (k == 5 || k == 6))
        || config.config.matrix.col_pins.some(k => (k == 5 || k == 6))) {
        return { 'master': masterConfig, 'slave': slaveConfig };
    }

    config = JSON.parse(baseConfig);
    config.config.matrix.row_pins = [...config.config.matrix.row_pins, ...config.config.matrix.row_pins];
    config.config.matrix.col_pins = [...config.config.matrix.col_pins, ...config.config.matrix.col_pins];
    config.config.matrix.diode_direction += 2;
    const lpmeConfig = JSON.stringify(config);

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

function updateInfo() {
    layoutList.innerHTML = "";
    infoJson.value = "";

    getKeyboard(keyboardList.value).then(
        info => {
            infoJson.value = JSON.stringify(info);
            updateLayouts();
        }
    ).catch(e => console.log('failed to parse keyboard', e));
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

main().then();