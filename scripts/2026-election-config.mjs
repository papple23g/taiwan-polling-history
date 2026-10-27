const KMT = '中國國民黨';
const DPP = '民主進步黨';
const TPP = '台灣民眾黨';
const independent = '無黨籍';

export const electionConfig2026 = {
  taipei: { region: '臺北市', office: '市長', pair: ['蔣萬安', '沈伯洋'], parties: { 蔣萬安: KMT, 沈伯洋: DPP }, baseline: true },
  'new-taipei': { region: '新北市', office: '市長', pair: ['李四川', '蘇巧慧'], parties: { 李四川: KMT, 蘇巧慧: DPP }, baseline: true },
  taoyuan: { region: '桃園市', office: '市長', pair: ['張善政', '黃世杰'], parties: { 張善政: KMT, 黃世杰: DPP }, baseline: true },
  taichung: { region: '臺中市', office: '市長', pair: ['江啟臣', '何欣純'], parties: { 江啟臣: KMT, 何欣純: DPP }, baseline: true },
  tainan: { region: '臺南市', office: '市長', pair: ['謝龍介', '陳亭妃'], parties: { 謝龍介: KMT, 陳亭妃: DPP }, baseline: true },
  kaohsiung: { region: '高雄市', office: '市長', pair: ['柯志恩', '賴瑞隆'], parties: { 柯志恩: KMT, 賴瑞隆: DPP }, baseline: true },
  keelung: { region: '基隆市', office: '市長', pair: ['謝國樑', '童子瑋'], parties: { 謝國樑: KMT, 童子瑋: DPP, 魏造文: independent } },
  'hsinchu-city': { region: '新竹市', office: '市長', pair: ['高虹安', '莊競程'], parties: { 高虹安: independent, 莊競程: DPP, 何志勇: independent } },
  hsinchu: { region: '新竹縣', office: '縣長', pair: ['徐欣瑩', '鄭朝方'], parties: { 徐欣瑩: KMT, 鄭朝方: DPP, 朱定瑀: independent } },
  changhua: { region: '彰化縣', office: '縣長', pair: ['魏平政', '陳素月'], parties: { 魏平政: KMT, 陳素月: DPP, 邱建富: independent, 陳重嘉: independent } },
  yunlin: { region: '雲林縣', office: '縣長', pair: ['張嘉郡', '劉建國'], parties: { 張嘉郡: KMT, 劉建國: DPP } },
  'chiayi-city': { region: '嘉義市', office: '市長', pair: ['張啓楷', '王美惠'], parties: { 張啓楷: TPP, 王美惠: DPP } },
  hualien: { region: '花蓮縣', office: '縣長', pair: ['游淑貞', '張峻'], parties: { 游淑貞: KMT, 張峻: independent, 魏嘉賢: independent } },
  kinmen: { region: '金門縣', office: '縣長', pair: ['陳玉珍', '李文良'], parties: { 陳玉珍: KMT, 李文良: independent, 張國威: independent, 洪和成: independent, 張火木: independent, 黃世團: independent, 梁文韜: independent } },
  zhubei: { region: '竹北市', office: '市長', pair: ['吳旭智', '曾聖凱'], parties: { 吳旭智: KMT, 曾聖凱: DPP, 邱臣遠: TPP, 李貞秀: independent }, sourceUrl: 'https://www.my-formosa.com.tw/DOC_229138.htm' },
  yilan: { region: '宜蘭縣', office: '縣長', pair: ['吳宗憲', '林國漳'], parties: { 吳宗憲: KMT, 林國漳: DPP, 陳琬惠: TPP }, sourceUrl: 'https://www.my-formosa.com.tw/DOC_224420.htm', partyLocator: '問卷Q2候選人姓名與政黨提示', partyEvidenceLevel: 'primary_questionnaire' },
};

export const indexCities2026 = Object.keys(electionConfig2026).filter(city => city !== 'zhubei');
