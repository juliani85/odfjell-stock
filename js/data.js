// Stock PM al 07/04/2026 19:00 - Odfjell Terminals Tagsa SA - Campana
const stockInicial = [
    {
        tanque: "005", producto: "MONOETILENGLICOL", cliente: "MILBERG Y ASOCIADOS",
        despachos: [
            { despacho: "DI26IC06000418R", stock: -4, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "FISCAL-ZZZZZOTUS36Y", stock: 1194, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "DI25IC04008428A", stock: 95085, cliente: "FAST-CHEMICAL S.R.L" },
            { despacho: "DI25IC04009472A", stock: 199789, cliente: "FAST-CHEMICAL S.R.L" },
        ]
    },
    {
        tanque: "007", producto: "SEBO (GRASA ANIMAL)", cliente: "COTO C.I.C.S.A",
        despachos: [
            { despacho: "PARTICULAR0437", stock: 1054320 },
            { despacho: "PARTICULAR2392", stock: 9076 },
            { despacho: "PARTICULAR0912", stock: 220 },
        ]
    },
    {
        tanque: "008", producto: "ACIDO ACETICO", cliente: "ATANOR S.C.A INV: X",
        despachos: [
            { despacho: "DI26IC04002280Y", stock: 251304 },
            { despacho: "DI26IC04001291P", stock: 307939 },
        ]
    },
    {
        tanque: "010", producto: "UNITOL L-70", cliente: "UNILEVER DE ARGENTIN",
        despachos: [
            { despacho: "DI26IC04002170M", stock: 30849 },
        ]
    },
    {
        tanque: "014", producto: "UNITOL L-70", cliente: "UNILEVER DE ARGENTIN",
        despachos: [
            { despacho: "DI26IC04002168T", stock: 431734 },
        ]
    },
    {
        tanque: "017", producto: "DIPROPILENGLICOL", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002174Z", stock: 323029 },
        ]
    },
    {
        tanque: "019", producto: "SOLVESSO 150", cliente: "BRENNTAG ARG.S.A.",
        despachos: [
            { despacho: "DI26IC06000430L", stock: 27000 },
            { despacho: "DI26IDA4000201A", stock: 92561 },
        ]
    },
    {
        tanque: "020", producto: "DOWANOL DPM", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "TK20DO1", stock: 159460 },
        ]
    },
    {
        tanque: "022", producto: "BUTIL CELLOSOLVE", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "BCETK22000001", stock: 49860 },
        ]
    },
    {
        tanque: "023", producto: "EXXSOL D-60", cliente: "BRENNTAG ARG.S.A.",
        despachos: [
            { despacho: "DI26IC04002559A", stock: 103888 },
            { despacho: "FISCAL-008BR568600794", stock: 28140 },
        ]
    },
    {
        tanque: "024", producto: "BUTIL ACRILATO MONOMERO", cliente: "DALGAR S.A.",
        despachos: [
            { despacho: "DI26IC04002561Z", stock: 83846, cliente: "CRILEN S.A" },
            { despacho: "FISCAL-USHOUOTUS-33-B", stock: 131364, cliente: "DIRANSA SRL" },
        ]
    },
    {
        tanque: "025", producto: "ACETATO DE VINILO", cliente: "DALGAR S.A.",
        despachos: [
            { despacho: "FISCAL-USTXTOTUS-18-A", stock: 49488 },
            { despacho: "FISCAL-USTXTOTUS-18-C", stock: 24744 },
        ]
    },
    {
        tanque: "026", producto: "ISOPAR E", cliente: "BRENNTAG ARG.S.A.",
        despachos: [
            { despacho: "DI23IC04009487E", stock: 127627 },
            { despacho: "DI21IPE00000093", stock: 10207 },
        ]
    },
    {
        tanque: "027", producto: "VORANOL 3011", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002235Y", stock: 264140 },
        ]
    },
    {
        tanque: "028", producto: "VORANOL 3011", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002235Y", stock: 288076 },
        ]
    },
    {
        tanque: "029", producto: "VORANOL 3011", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002235Y", stock: 286160 },
        ]
    },
    {
        tanque: "030", producto: "ACETATO DE VINILO", cliente: "INMOBAL NUTRER S.A.",
        despachos: [
            { despacho: "DI26IC04000202G", stock: 21585 },
        ]
    },
    {
        tanque: "033", producto: "SOLVESSO 100", cliente: "BRENNTAG ARG.S.A.",
        despachos: [
            { despacho: "DI26IDA4000200W", stock: 26559 },
            { despacho: "FISCAL-USHOUOTUS22B", stock: 149454 },
        ]
    },
    {
        tanque: "034", producto: "BUTIL ACRILATO MONOMERO", cliente: "DALGAR S.A.",
        despachos: [
            { despacho: "DI25IC06001144N", stock: 16828 },
            { despacho: "FISCAL-USHOUOTUS-09-B", stock: 256 },
            { despacho: "FISCAL-USHOUOTUS-09-C", stock: 25895 },
            { despacho: "FISCAL-USHOUOTUS-09-D", stock: 175847 },
            { despacho: "FISCAL-USHOUOTUS-33-B", stock: 119592 },
        ]
    },
    {
        tanque: "036", producto: "MONOETILENGLICOL", cliente: "MILBERG Y ASOCIADOS",
        despachos: [
            { despacho: "FISCAL-ZZZZZOTUS36Y", stock: 18553, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "DI26IC04001041X", stock: 82937, cliente: "TOTAL ESPECIALIDADES" },
            { despacho: "DI26TRM6000107V", stock: 26963, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "DI26IC06000407P", stock: 438, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "FISCAL-ZZZZZOTUS22Y", stock: 26963, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "FISCAL-ZZZZZOTUS22Z", stock: 26963, cliente: "MILBERG Y ASOCIADOS" },
        ]
    },
    {
        tanque: "037", producto: "SURFOM", cliente: "INDOVINYA ARGENTINA",
        despachos: [
            { despacho: "DI25IC04007533T", stock: 22460 },
            { despacho: "DI25IC04007128T", stock: 22470 },
            { despacho: "DI25IC04006722S", stock: 1070 },
            { despacho: "DI25IC04007757E", stock: 22510 },
            { despacho: "DI25IC04007878X", stock: 22450 },
            { despacho: "DI25IC04007129U", stock: 22530 },
            { despacho: "DI25IC04007361S", stock: 22530 },
            { despacho: "DI25IC04007598H", stock: 22450 },
            { despacho: "FISCAL-BRIOAOXT202508012", stock: 22620 },
            { despacho: "DI25IC04007530Z", stock: 22510 },
        ]
    },
    {
        tanque: "041", producto: "ACIDO PROPIONICO", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002546T", stock: 186951 },
        ]
    },
    {
        tanque: "042", producto: "ACIDO ACETICO", cliente: "ATANOR S.C.A INV: X",
        despachos: [
            { despacho: "DI26IC04002280Y", stock: 354996 },
        ]
    },
    {
        tanque: "045", producto: "GASOLINA DE AVIACION", cliente: "YPF S.A XAB052",
        despachos: [
            { despacho: "26IC65000013N", stock: 832210 },
        ]
    },
    {
        tanque: "052", producto: "ACETATO DE ETILO", cliente: "HENRY HIRSCHEN & CIA",
        despachos: [
            { despacho: "DI26IC06000402K", stock: 66615 },
        ]
    },
    {
        tanque: "054", producto: "2 ETIL HEXANOL", cliente: "MILBERG Y ASOCIADOS",
        despachos: [
            { despacho: "DI26IC04002644S", stock: 210717, cliente: "CHEMOTECNICA S.A." },
            { despacho: "DI26IC04002657W", stock: -15, cliente: "SIGMA AGRO S.A." },
            { despacho: "DI26IC04002656V", stock: 5, cliente: "SIGMA AGRO S.A." },
            { despacho: "DI26IC04002654T", stock: 26365, cliente: "SIGMA AGRO S.A." },
            { despacho: "FISCAL-USHOUOTUS29I", stock: 26365, cliente: "SINER SA" },
            { despacho: "FISCAL-USHOUOTUS29J", stock: 26365, cliente: "SINER SA" },
            { despacho: "FISCAL-USHOUOTUS29K", stock: 26365, cliente: "SINER SA" },
            { despacho: "DI26IC04002597C", stock: 5484, cliente: "TRAPALCO S.A." },
            { despacho: "DI26IC04002594W", stock: 43306, cliente: "VARTECO QUIMICA PUNT" },
        ]
    },
    {
        tanque: "057", producto: "GASOLINA DE AVIACION", cliente: "YPF S.A XAB052",
        despachos: [
            { despacho: "26IC65000013N", stock: 251711 },
        ]
    },
    {
        tanque: "058", producto: "2 ETIL HEXANOL", cliente: "ATANOR S.C.A INV: X / MILBERG",
        despachos: [
            { despacho: "DI26IC04002552Z", stock: 53402, cliente: "ATANOR S.C.A INV: X" },
            { despacho: "DI26IC04002594W", stock: 1012, cliente: "VARTECO QUIMICA PUNT" },
        ]
    },
    {
        tanque: "059", producto: "GASOLINA DE AVIACION", cliente: "YPF S.A XAB052",
        despachos: [
            { despacho: "26IC65000013N", stock: 791481 },
            { despacho: "25IC05003038Z", stock: 22774 },
        ]
    },
    {
        tanque: "063", producto: "2 ETIL HEXANOL", cliente: "MILBERG Y ASOCIADOS",
        despachos: [
            { despacho: "FISCAL-USHOUOTUS43S-1", stock: 26621, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "FISCAL-USHOUOTUS43S-2", stock: 26621, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "FISCAL-USHOUOTUS43S-3", stock: 26621, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "DI25IC04008358C", stock: 712, cliente: "MILBERG Y ASOCIADOS" },
            { despacho: "FISCAL-USHOUOTUS29S", stock: 26365, cliente: "AGROFACIL S.A." },
            { despacho: "FISCAL-USHOUOTUS29T", stock: 26365, cliente: "AGROFACIL S.A." },
            { despacho: "FISCAL-USHOUOTUS29U", stock: 26365, cliente: "AGROFACIL S.A." },
            { despacho: "FISCAL-USHOUOTUS29V", stock: 26365, cliente: "AGROFACIL S.A." },
            { despacho: "FISCAL-USHOUOTUS29N", stock: 26365, cliente: "MINERA EXAR S.A." },
            { despacho: "FISCAL-USHOUOTUS29O", stock: 26365, cliente: "MINERA EXAR S.A." },
            { despacho: "FISCAL-USHOUOTUS29P", stock: 26365, cliente: "MINERA EXAR S.A." },
            { despacho: "FISCAL-USHOUOTUS29Q", stock: 26365, cliente: "MINERA EXAR S.A." },
            { despacho: "FISCAL-USHOUOTUS29R", stock: 26365, cliente: "MINERA EXAR S.A." },
            { despacho: "DI26IC04002597C", stock: 20881, cliente: "TRAPALCO S.A." },
        ]
    },
    {
        tanque: "067", producto: "BUTIL ACRILATO MONOMERO", cliente: "DALGAR S.A.",
        despachos: [
            { despacho: "FISCAL-USHOUOTUS-09-B", stock: 111294, cliente: "DIRANSA SRL" },
            { despacho: "DI26IC06000439U", stock: 9, cliente: "DIRANSA SRL" },
            { despacho: "DI25IDA4002307X", stock: 13126, cliente: "DALGAR S.A." },
            { despacho: "DI26TR06002038U", stock: -20, cliente: "DALGAR S.A." },
            { despacho: "FISCAL-USHOUOTUS-33-B", stock: 4692, cliente: "DIRANSA SRL" },
            { despacho: "FISCAL-USHOUOTUS-33-D", stock: 228700, cliente: "DALGAR S.A." },
        ]
    },
    {
        tanque: "069", producto: "ARCOL F3040 (POLYOL)", cliente: "ALKANOS S.A.",
        despachos: [
            { despacho: "DI26IC06000348T", stock: 11876 },
            { despacho: "DI26IC06000484U", stock: 56000 },
        ]
    },
    {
        tanque: "071", producto: "BENZOL", cliente: "TERNIUM ARGENTINA S.",
        despachos: [
            { despacho: "FISCAL", stock: 363419 },
        ]
    },
    {
        tanque: "073", producto: "BENZOL", cliente: "TERNIUM ARGENTINA S.",
        despachos: [
            { despacho: "FISCAL", stock: 132340 },
        ]
    },
    {
        tanque: "074", producto: "ALKONAT L10 CL", cliente: "UNILEVER DE ARGENTIN",
        despachos: [
            { despacho: "DI26IC04002172Y", stock: 60139 },
        ]
    },
    {
        tanque: "076", producto: "DIFENILMETANO DIISOCIANATO", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002547U", stock: 359974 },
        ]
    },
    {
        tanque: "079", producto: "ISOPAR E", cliente: "BRENNTAG ARG.S.A.",
        despachos: [
            { despacho: "DI24IC04004673U", stock: 245678 },
            { despacho: "DI25IC04006156T", stock: 202681 },
        ]
    },
    {
        tanque: "081", producto: "ISOPAR L", cliente: "BRENNTAG ARG.S.A.",
        despachos: [
            { despacho: "DI25IDA4001947R", stock: 50000 },
            { despacho: "DI26IC04000451Y", stock: 10075 },
            { despacho: "DI26IC06000490R", stock: 8756 },
            { despacho: "FISCAL-USHOUOTUS21B", stock: 100930 },
        ]
    },
    {
        tanque: "082", producto: "ALKONAT L10 CL", cliente: "UNILEVER DE ARGENTIN",
        despachos: [
            { despacho: "DI26IC04002167S", stock: 208749 },
        ]
    },
    {
        tanque: "083", producto: "VORANOL 3945", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI25ID17112025L", stock: 559680 },
        ]
    },
    {
        tanque: "084", producto: "PROPILENGLICOL USP", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002173P", stock: 666538 },
        ]
    },
    {
        tanque: "085", producto: "FENOL", cliente: "ATANOR S.C.A INV: X",
        despachos: [
            { despacho: "DI26IC04002553R", stock: 901004 },
        ]
    },
    {
        tanque: "088", producto: "PROPILENGLICOL USP", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002173P", stock: 411835 },
            { despacho: "DI26IDA4000458Y", stock: 78561 },
            { despacho: "DI25IDA4000161E", stock: 28000 },
            { despacho: "DI25IC06001290P", stock: 156179 },
        ]
    },
    {
        tanque: "091", producto: "ACETATO DE ETILO", cliente: "QUIMICA CALLEGARI S.",
        despachos: [
            { despacho: "DI26IC65000628T", stock: 14531 },
        ]
    },
    {
        tanque: "092", producto: "N-PROPANOL", cliente: "QUIMICA CALLEGARI S.",
        despachos: [
            { despacho: "26IC65000014Y", stock: 286391 },
        ]
    },
    {
        tanque: "093", producto: "ACETATO DE ETILO", cliente: "QUIMICA CALLEGARI S.",
        despachos: [
            { despacho: "DI26IC65000628T", stock: 345784 },
        ]
    },
    {
        tanque: "094", producto: "ACETONA", cliente: "QUIMICA CALLEGARI S.",
        despachos: [
            { despacho: "26IC65000015P", stock: 212142 },
        ]
    },
    {
        tanque: "096", producto: "BUTIL CELLOSOLVE", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04000802M", stock: 103612 },
        ]
    },
];

// Capacidades de tanques en litros al 98% — Fuente: IC-36-26-F-02 (Rev 1, 20/02/2025)
const capacidadTanques = {
    "001": 652736, "002": 1238147, "003": 1236940, "004": 1237265, "005": 651852,
    "006": 1234218, "007": 1236978, "008": 1231977, "009": 650703, "010": 650850,
    "011": 652355, "012": 650469, "013": 652333, "014": 650557, "015": 650421,
    "016": 654258, "017": 651081, "018": 652319, "019": 291273, "020": 294063,
    "021": 293025, "022": 293488, "023": 293603, "024": 293462, "025": 293296,
    "026": 292882, "027": 292698, "028": 293176, "029": 293090, "030": 293439,
    "031": 407884, "032": 407879, "033": 408556, "034": 408201, "035": 407145,
    "036": 407889, "037": 408751, "038": 406686, "039": 407578, "040": 407064,
    "041": 408175, "042": 408417, "043": 1234808, "044": 1233371, "045": 1234663,
    "046": 1234546, "047": 649116, "048": 647886, "049": 649038, "050": 649983,
    "051": 652526, "052": 650384, "053": 650346, "054": 648723, "055": 651290,
    "056": 651138, "057": 1239742, "058": 1240797, "059": 1239473, "060": 1239941,
    "061": 651609, "062": 649805, "063": 650552, "064": 651769, "065": 650925,
    "066": 651497, "067": 651848, "068": 650769, "069": 651117, "070": 651023,
    "071": 1242638, "072": 1240653, "073": 1238968, "074": 1239759, "075": 651527,
    "076": 651419, "077": 652548, "078": 652155, "079": 647758, "080": 650063,
    "081": 651504, "082": 649773, "083": 651727, "084": 651760, "085": 1239676,
    "086": 1240206, "087": 1238421, "088": 1240324, "089": 405003, "090": 403262,
    "091": 403042, "092": 402169, "093": 403903, "094": 403510, "095": 403711,
    "096": 406821, "097": 403532, "098": 403683, "099": 403648, "100": 404698,
    "101": 404079, "102": 403730,
};

// Tanques desafectados (no operables). No deben aparecer en stock ni en los
// dropdowns de movimientos (salida, ingreso, transferencia).
const tanquesDesafectados = [
    "003", "016", "020", "022", "026", "040", "043", "045", "053", "057",
    "059", "062", "064", "066", "068", "070", "077", "083", "087", "090",
    "091", "092", "093", "094", "095", "098",
];
