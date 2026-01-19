export async function onRequest(context) {
    const request = context.request;
    const origin = request.headers.get("Origin");
    const allowedOrigin = "https://app.byvoxel.com"; // Tu dominio real

    // Si la petición viene de otro lado (y no es null/postman), bloquéala
    if (origin && origin !== allowedOrigin && !origin.includes("localhost")) {
        return new Response("Acceso prohibido: No robes mi API", { status: 403 });
    }



// functions/api/calculate.js

// 1. DATOS (Tablas del NEC)
const wireTable = [
    { size: "14 AWG", cap60: 15, cap75: 20, ground: "14 AWG", area: 0.0097 },
    { size: "12 AWG", cap60: 20, cap75: 25, ground: "12 AWG", area: 0.0133 },
    { size: "10 AWG", cap60: 30, cap75: 35, ground: "10 AWG", area: 0.0211 },
    { size: "8 AWG",  cap60: 40, cap75: 50, ground: "10 AWG", area: 0.0366 },
    { size: "6 AWG",  cap60: 55, cap75: 65, ground: "10 AWG", area: 0.0507 },
    { size: "4 AWG",  cap60: 70, cap75: 85, ground: "10 AWG", area: 0.0824 },
    { size: "3 AWG",  cap60: 85, cap75: 100, ground: "8 AWG", area: 0.0973 },
    { size: "2 AWG",  cap60: 95, cap75: 115, ground: "8 AWG", area: 0.1158 },
    { size: "1 AWG",  cap60: 110, cap75: 130, ground: "6 AWG", area: 0.1562 },
    { size: "1/0 AWG", cap60: 125, cap75: 150, ground: "6 AWG", area: 0.1855 },
    { size: "2/0 AWG", cap60: 145, cap75: 175, ground: "6 AWG", area: 0.2223 },
    { size: "3/0 AWG", cap60: 165, cap75: 200, ground: "6 AWG", area: 0.2679 },
    { size: "4/0 AWG", cap60: 195, cap75: 230, ground: "4 AWG", area: 0.3237 }
];

const emtSizes = [
    { name: "1/2\"",  area40: 0.122 },
    { name: "3/4\"",  area40: 0.213 },
    { name: "1\"",    area40: 0.346 },
    { name: "1-1/4\"", area40: 0.598 },
    { name: "1-1/2\"", area40: 0.814 },
    { name: "2\"",    area40: 1.342 }
];

const standardBreakers = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 200];

// 2. FUNCIONES AUXILIARES
function getWireData(amps, method) {
    for (let i = 0; i < wireTable.length; i++) {
        let capacity = (method === 'nmb') ? wireTable[i].cap60 : wireTable[i].cap75;
        let limit = capacity;
        if (wireTable[i].size.startsWith("14")) limit = 15;
        if (wireTable[i].size.startsWith("12")) limit = 20;
        if (wireTable[i].size.startsWith("10")) limit = 30;

        if (limit >= amps) {
            return { ...wireTable[i], usedCap: limit };
        }
    }
    return { size: "Consult Engineer", ground: "Consult Engineer", usedCap: 0, area: 0 };
}

function getWireArea(sizeStr) {
    const w = wireTable.find(item => item.size === sizeStr);
    return w ? w.area : 0;
}

function calculateConduit(mainWire, groundWire, voltage) {
    const mainArea = mainWire.area;
    const groundArea = getWireArea(groundWire);
    let numMain = (voltage === 120) ? 2 : 3; 
    let numGround = 1;
    let totalArea = (numMain * mainArea) + (numGround * groundArea);

    let size = "Consult Engineer (>2\")";
    for(let emt of emtSizes) {
        if (emt.area40 >= totalArea) {
            size = emt.name;
            break;
        }
    }
    return { size, numMain, numGround };
}

function generateCableDetails(amps, voltage, wireSize, method, groundSize) {
    let gauge = wireSize.split(' ')[0]; 
    if(wireSize.includes('/')) gauge = wireSize.split(' ')[0];

    let cableStr = "";
    let colors = "";
    let insulStr = "";
    let conduitInfo = null;

    if (method === 'nmb') {
        insulStr = "PVC Jacket (60°C)";
        if (voltage === 120) {
            cableStr = `${gauge}/2 NM-B (Romex)`;
            colors = "Black, White, Bare";
        } else {
            cableStr = `Option A: ${gauge}/2 NM-B (Pure 240)\nOption B: ${gauge}/3 NM-B (120/240)`;
            colors = "2-Wire: Blk, Wht(Red), Gnd\n3-Wire: Blk, Red, Wht, Gnd";
        }
    } else {
        insulStr = "THHN/THWN-2 (75°C)";
        const mainWireObj = wireTable.find(w => w.size === wireSize);
        if(mainWireObj) {
            conduitInfo = calculateConduit(mainWireObj, groundSize, voltage);
            cableStr = `${conduitInfo.numMain}x ${gauge} AWG + 1x ${groundSize.split(' ')[0]} Gnd`;
        } else {
            cableStr = "Error calculating wires";
        }
        if (voltage === 120) colors = "1 Black, 1 White, 1 Green";
        else colors = "2 Hots, 1 White (if needed), 1 Green";
    }
    return { cableStr, colors, insulStr, conduitInfo };
}

// 3. CONTROLADOR DE LA API (Cloudflare Pages Function)
export async function onRequest(context) {
    const url = new URL(context.request.url);
    
    // Lectura de parámetros
    const mode = url.searchParams.get("mode");
    const voltage = parseInt(url.searchParams.get("voltage"));
    const method = url.searchParams.get("method");
    const isContinuous = url.searchParams.get("continuous") === 'true';

    let result = {};

    if (mode === 'breaker') {
        const breakerAmps = parseInt(url.searchParams.get("amps"));
        const usableAmps = isContinuous ? breakerAmps * 0.8 : breakerAmps;
        const maxWatts = usableAmps * voltage;
        
        let wireData = getWireData(breakerAmps, method);
        let details = generateCableDetails(breakerAmps, voltage, wireData.size, method, wireData.ground);

        result = {
            mode: 'breaker',
            limitLabel: "SAFE MAX POWER",
            limitVal: `${Math.round(maxWatts)}W`,
            configText: `${breakerAmps}A Breaker @ ${voltage}V`,
            calcAmps: `${usableAmps.toFixed(1)} A`,
            loadType: isContinuous ? "CONTINUOUS (80%)" : "INTERMITTENT (100%)",
            wireSize: wireData.size,
            groundSize: wireData.ground,
            insulation: details.insulStr,
            cableType: details.cableStr,
            colors: details.colors,
            conduitInfo: details.conduitInfo
        };

    } else if (mode === 'power') {
        let watts = parseFloat(url.searchParams.get("watts"));
        if (!watts || watts < 0) watts = 0;

        let actualAmps = watts / voltage;
        let requiredBreakerAmps = isContinuous ? actualAmps * 1.25 : actualAmps;
        
        let selectedBreaker = standardBreakers.find(b => b >= requiredBreakerAmps);
        if (!selectedBreaker && requiredBreakerAmps > 0) selectedBreaker = "> 200";
        if (watts === 0) selectedBreaker = 0;

        let wireData = { size: "-", ground: "-", area: 0 };
        let details = { cableStr: "-", colors: "-", insulStr: "-" };

        if (typeof selectedBreaker === 'number' && selectedBreaker > 0) {
            wireData = getWireData(selectedBreaker, method);
            details = generateCableDetails(selectedBreaker, voltage, wireData.size, method, wireData.ground);
        }

        let warning = null;
        if (isContinuous && selectedBreaker === "> 200") {
             warning = "Load exceeds residential standards (>200A).";
        }

        result = {
            mode: 'power',
            limitLabel: "REQUIRED BREAKER",
            limitVal: selectedBreaker ? `${selectedBreaker}A` : "-",
            configText: `Load: ${watts}W @ ${voltage}V`,
            calcAmps: `${actualAmps.toFixed(1)} A`,
            loadType: isContinuous ? "CONTINUOUS (125%)" : "INTERMITTENT",
            wireSize: wireData.size,
            groundSize: wireData.ground || "-",
            insulation: details.insulStr,
            cableType: details.cableStr,
            colors: details.colors,
            conduitInfo: details.conduitInfo,
            warning: warning
        };
    }

    // Respuesta JSON simple
    return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" }
    });

}
