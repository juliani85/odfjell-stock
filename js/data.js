const stockInicial = [
    {
        tanque: "005", producto: "MONOETILENGLICOL", cliente: "MILBERG Y ASOCIADOS",
        despachos: [
            { despacho: "DI26IC06000417Z", stock: 10 },
            { despacho: "DI26IC06000418R", stock: 26658 },
            { despacho: "DI26IC06000419S", stock: 26658 },
        ]
    },
    {
        tanque: "007", producto: "SEBO (GRASA ANIMAL)", cliente: "COTO C.I.C.S.A",
        despachos: [
            { despacho: "PARTICULAR0437", stock: 912540 },
            { despacho: "PARTICULAR2392", stock: 9076 },
            { despacho: "PARTICULAR0912", stock: 220 },
        ]
    },
    {
        tanque: "008", producto: "ACIDO ACETICO", cliente: "ATANOR S.C.A INV: X",
        despachos: [
            { despacho: "DI26IC04002280Y", stock: 251304 },
            { despacho: "DI26IC04001291P", stock: 411959 },
        ]
    },
    {
        tanque: "010", producto: "UNITOL L-70", cliente: "UNILEVER DE ARGENTIN",
        despachos: [
            { despacho: "DI26IC04002170M", stock: 60469 },
        ]
    },
    {
        tanque: "014", producto: "UNITOL L-70", cliente: "UNILEVER DE ARGENTIN",
        despachos: [
            { despacho: "DI26IC04002168T", stock: 576974 },
        ]
    },
    {
        tanque: "017", producto: "DIPROPILENGLICOL", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002174Z", stock: 358029 },
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
            { despacho: "BCETK22000001", stock: 77880 },
        ]
    },
    {
        tanque: "023", producto: "EXXSOL D-60", cliente: "BRENNTAG ARG.S.A.",
        despachos: [
            { despacho: "DI26IC04002559A", stock: 178908 },
        ]
    },
    {
        tanque: "024", producto: "BUTIL ACRILATO MONOMERO", cliente: "DALGAR S.A.",
        despachos: [
            { despacho: "FISCAL-CRILEN", stock: 111846 },
            { despacho: "FISCAL-DIRANSA", stock: 131364 },
        ]
    },
    {
        tanque: "025", producto: "ACETATO DE VINILO", cliente: "DALGAR S.A.",
        despachos: [
            { despacho: "FISCAL-USTXTOTUS-18-A", stock: 49488 },
            { despacho: "DI26IC06000479B", stock: -16 },
            { despacho: "FISCAL-USTXTOTUS-18-C", stock: 24744 },
        ]
    },
    {
        tanque: "026", producto: "ISOPAR E", cliente: "BRENNTAG ARG.S.A.",
        despachos: [
            { despacho: "DI23IC04009487E", stock: 144647 },
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
            { despacho: "DI26IC04002235Y", stock: 288400 },
        ]
    },
    {
        tanque: "030", producto: "ACETATO DE VINILO", cliente: "INMOBAL NUTRER S.A.",
        despachos: [
            { despacho: "DI26IC04000202G", stock: 21585 },
        ]
    },
    {
        tanque: "031", producto: "VORANOL 3011", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002235Y", stock: 229549 },
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
            { despacho: "DI25IC06001144N", stock: 41708 },
            { despacho: "FISCAL-USHOUOTUS-09-B", stock: 256 },
            { despacho: "FISCAL-USHOUOTUS-09-C", stock: 25895 },
            { despacho: "FISCAL-USHOUOTUS-09-D", stock: 175847 },
            { despacho: "FISCAL-USHOUOTUS-33-B", stock: 119592 },
        ]
    },
    {
        tanque: "036", producto: "MONOETILENGLICOL", cliente: "MILBERG Y ASOCIADOS",
        despachos: [
            { despacho: "FISCAL-ZZZZZOTUS36Y", stock: 18553 },
            { despacho: "DI26IC04001041X", stock: 109457 },
            { despacho: "FISCAL-ZZZZZOTUS22AA", stock: 26963 },
            { despacho: "DI26IC06000407P", stock: 10158 },
            { despacho: "FISCAL-ZZZZZOTUS22Y", stock: 26963 },
            { despacho: "FISCAL-ZZZZZOTUS22Z", stock: 26963 },
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
            { despacho: "DI26IC06000148R", stock: 4580 },
            { despacho: "FISCAL-USTXTOTUS-13B", stock: 207371 },
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
        tanque: "050", producto: "MONOETILENGLICOL", cliente: "MILBERG Y ASOCIADOS",
        despachos: [
            { despacho: "FISCAL-ZZZZZOTUS36Y", stock: 1194 },
            { despacho: "DI25IC04009472A", stock: 199789 },
        ]
    },
    {
        tanque: "052", producto: "ACETATO DE ETILO", cliente: "HENRY HIRSCHEN & CIA",
        despachos: [
            { despacho: "DI26IC06000402K", stock: 86615 },
        ]
    },
    {
        tanque: "054", producto: "2 ETIL HEXANOL", cliente: "MILBERG Y ASOCIADOS",
        despachos: [
            { despacho: "FISCAL-USHOUOTUS29E", stock: 238717 },
            { despacho: "FISCAL-USHOUOTUS29F", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29G", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29H", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29I", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29J", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29K", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29L", stock: 5484 },
            { despacho: "FISCAL-USHOUOTUS29C", stock: 127046 },
        ]
    },
    {
        tanque: "055", producto: "MONOETILENGLICOL", cliente: "MILBERG Y ASOCIADOS",
        despachos: [
            { despacho: "DI25IC04008384B", stock: 67930 },
            { despacho: "DI25IC04008428A", stock: 135175 },
        ]
    },
    {
        tanque: "057", producto: "GASOLINA DE AVIACION", cliente: "YPF S.A XAB052",
        despachos: [
            { despacho: "26IC65000013N", stock: 378491 },
        ]
    },
    {
        tanque: "058", producto: "2 ETIL HEXANOL", cliente: "ATANOR S.C.A INV: X / MILBERG",
        despachos: [
            { despacho: "DI26IC04002552Z", stock: 110302 },
            { despacho: "FISCAL-USHOUOTUS29C", stock: 1012 },
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
            { despacho: "FISCAL-USHOUOTUS43S-1", stock: 26621 },
            { despacho: "FISCAL-USHOUOTUS43S-2", stock: 26621 },
            { despacho: "FISCAL-USHOUOTUS43S-3", stock: 26621 },
            { despacho: "DI25IC04008358C", stock: 712 },
            { despacho: "FISCAL-USHOUOTUS29S", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29T", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29U", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29V", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29N", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29O", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29P", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29Q", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29R", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29M", stock: 26365 },
            { despacho: "FISCAL-USHOUOTUS29L", stock: 20881 },
        ]
    },
    {
        tanque: "067", producto: "BUTIL ACRILATO MONOMERO", cliente: "DALGAR S.A.",
        despachos: [
            { despacho: "FISCAL-USHOUOTUS-09-B", stock: 111294 },
            { despacho: "DI26IC06000436R", stock: -20 },
            { despacho: "DI26IC06000439U", stock: 21289 },
            { despacho: "DI25IDA4002307X", stock: 94126 },
            { despacho: "FISCAL-USHOUOTUS-33-B", stock: 4692 },
            { despacho: "FISCAL-USHOUOTUS-33-D", stock: 228700 },
            { despacho: "FISCAL-USHOUOTUS-33-C", stock: 27962 },
        ]
    },
    {
        tanque: "069", producto: "ARCOL F3040 (POLYOL)", cliente: "ALKANOS S.A.",
        despachos: [
            { despacho: "DI26IC06000348T", stock: 71856 },
            { despacho: "DI26IC06000484U", stock: 56000 },
            { despacho: "DI26TRM6000097G", stock: 28000 },
        ]
    },
    {
        tanque: "071", producto: "BENZOL", cliente: "TERNIUM ARGENTINA S.",
        despachos: [
            { despacho: "FISCAL", stock: 273159 },
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
            { despacho: "DI26IC04002172Y", stock: 242139 },
        ]
    },
    {
        tanque: "076", producto: "DIFENILMETANO DIISOCIANATO", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "FISCAL-USXASOTUS-11-B", stock: 399734 },
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
            { despacho: "DI26IC04002167S", stock: 234749 },
        ]
    },
    {
        tanque: "083", producto: "VORANOL 3945", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI25ID17112025L", stock: 629620 },
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
            { despacho: "DI26IC04002553R", stock: 1040004 },
        ]
    },
    {
        tanque: "088", producto: "PROPILENGLICOL USP", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04002173P", stock: 411835 },
            { despacho: "DI26IDA4000458Y", stock: 78561 },
            { despacho: "DI26TRM6000096F", stock: 28000 },
            { despacho: "DI25IDA4000161E", stock: 28000 },
            { despacho: "DI25IC06001290P", stock: 259179 },
        ]
    },
    {
        tanque: "091", producto: "ACETATO DE ETILO", cliente: "QUIMICA CALLEGARI S.",
        despachos: [
            { despacho: "DI26IC65000628T", stock: 169651 },
        ]
    },
    {
        tanque: "092", producto: "N-PROPANOL", cliente: "QUIMICA CALLEGARI S.",
        despachos: [
            { despacho: "26IC65000014Y", stock: 315591 },
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
            { despacho: "26IC65000015P", stock: 270022 },
        ]
    },
    {
        tanque: "096", producto: "BUTIL CELLOSOLVE", cliente: "PBBPOLISUR S.R.L.",
        despachos: [
            { despacho: "DI26IC04000802M", stock: 103612 },
            { despacho: "DI26IC04001018M", stock: 9 },
        ]
    },
];
