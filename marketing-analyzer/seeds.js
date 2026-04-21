/* ============================================================
   ZUIDOOST SEED — anchor list of office buildings.
   These get inserted into Supabase when you click "Load samples"
   in the dashboard, or run `node analyze.mjs --seed`.

   URLs left blank intentionally where I'm not 100% sure.
   Fill them in by hand from Google Maps + the building's own brokers
   before running the analyzer — no fake URLs.
   ============================================================ */

const ZUIDOOST_SEEDS = [
  {
    name: 'Atlas ArenA',
    address: 'Hoogoorddreef 7',
    postcode: '1101 BA',
    url: 'https://atlasarena.nl',
  },
  {
    name: 'EQ Amsterdam',
    address: 'Hoogoorddreef 60',
    postcode: '1101 BE',
    url: 'https://eq-amsterdam.com',
  },
  {
    name: 'ArenAPoort',
    address: 'Burgemeester Stramanweg 101',
    postcode: '1101 AA',
    url: '',
  },
  {
    name: 'ING House (Amsterdamse Poort)',
    address: 'Bijlmerplein 888',
    postcode: '1102 MG',
    url: '',
  },
  {
    name: 'The Edge Olympic',
    address: 'Fred. Roeskestraat 100',
    postcode: '1076 ED',
    url: 'https://www.edge.tech',
  },
  {
    name: 'Vivaldi Tower',
    address: 'Gustav Mahlerlaan 1212',
    postcode: '1082 MK',
    url: '',
  },
  {
    name: 'Frankemaheerd Cluster',
    address: 'Frankemaheerd 1',
    postcode: '1102 AN',
    url: '',
  },
  {
    name: 'Sandberg Plein',
    address: 'Sandberg Plein 5',
    postcode: '1102 AS',
    url: '',
  },
];

if (typeof window !== 'undefined') {
  window.ZUIDOOST_SEEDS = ZUIDOOST_SEEDS;
}
if (typeof module !== 'undefined') {
  module.exports = { ZUIDOOST_SEEDS };
}
