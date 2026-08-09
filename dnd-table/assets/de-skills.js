/* =========================================================
 * 跑团桌 · 文字冒险：技能数据 (de-skills.js)
 * 极乐迪斯科式 24 技能：智力/精神/体格/运动 四组
 * base = 新角色初始技能值
 * ========================================================= */
(function (global) {
  'use strict';
  var DnD = global.DnD = global.DnD || {};

  /* 四组主题色：智力红 / 精神紫 / 体格绿 / 运动黄 */
  DnD.DE_GROUPS = {
    智力: '#e0675c',
    精神: '#a97fd8',
    体格: '#5fa86a',
    运动: '#d9a441'
  };

  DnD.DE_SKILLS = [
    /* ---- 智力 ---- */
    { name: '逻辑思维', en: 'Logic', group: '智力', base: 2,
      desc: '把现象串成链条的能力。推理、演绎、识破矛盾。' },
    { name: '博学多闻', en: 'Encyclopedia', group: '智力', base: 1,
      desc: '记忆与常识的仓库。想起来：你以前知道这个。' },
    { name: '能说会道', en: 'Rhetoric', group: '智力', base: 2,
      desc: '话术与措辞。把一句话说得让对方无法反驳。' },
    { name: '视觉演算', en: 'Visual Calculus', group: '智力', base: 1,
      desc: '在脑中重建现场。脚印、角度、弹道。' },
    { name: '创意', en: 'Conceptualization', group: '智力', base: 1,
      desc: '抽象思维与艺术感受。把世界看作一个概念。' },
    { name: '演技', en: 'Drama', group: '智力', base: 1,
      desc: '谎言与表演。当世界需要你装作另一个人。' },

    /* ---- 精神 ---- */
    { name: '同感', en: 'Empathy', group: '精神', base: 3,
      desc: '读懂别人的心。他们在说谎，还是受伤？' },
    { name: '权威', en: 'Authority', group: '精神', base: 2,
      desc: '让别人服从你的气场。警官就该有警官的样子。' },
    { name: '从容自若', en: 'Composure', group: '精神', base: 2,
      desc: '不被情绪击穿。维持体面，哪怕内心已经裂开。' },
    { name: '内陆帝国', en: 'Inland Empire', group: '精神', base: 2,
      desc: '直觉与超现实感知。领带在跟你说话，信不信？' },
    { name: '意志力', en: 'Volition', group: '精神', base: 2,
      desc: '精神的盔甲。对抗绝望、恐惧与自我毁灭。' },
    { name: '说服', en: 'Suggestion', group: '精神', base: 1,
      desc: '温柔地推动他人。让人自愿做你希望的事。' },

    /* ---- 体格 ---- */
    { name: '身强体健', en: 'Physical Instrument', group: '体格', base: 2,
      desc: '肌肉的语言。必要时，拳头就是论据。' },
    { name: '坚韧不拔', en: 'Endurance', group: '体格', base: 2,
      desc: '身体扛得住。宿醉、殴打、世界的恶意。' },
    { name: '铜皮铁骨', en: 'Pain Threshold', group: '体格', base: 1,
      desc: '与疼痛共存。伤口只是另一种信号。' },
    { name: '疑神疑鬼', en: 'Half Light', group: '体格', base: 1,
      desc: '战斗本能。世界充满敌意——准备好。' },
    { name: '电化学', en: 'Electrochemistry', group: '体格', base: 1,
      desc: '对快感的渴望。酒、烟、多巴胺的呓语。' },
    { name: '标新立异', en: 'Savoir Faire', group: '体格', base: 1,
      desc: '风格与街头的智慧。穿得像自己，才配得上自己。' },

    /* ---- 运动 ---- */
    { name: '五感发达', en: 'Perception', group: '运动', base: 3,
      desc: '看见、听见、闻到。细节不会说谎。' },
    { name: '反应敏捷', en: 'Reaction Speed', group: '运动', base: 2,
      desc: '在事情发生前先动。比子弹快，比巴掌快。' },
    { name: '手眼协调', en: 'Hand/Eye Coordination', group: '运动', base: 1,
      desc: '让双手做大脑还没想好的事。' },
    { name: '使用设备', en: 'Interfacing', group: '运动', base: 1,
      desc: '机械的共情。门锁、收音机、所有会响的物件。' },
    { name: '天人感应', en: 'Shivers', group: '运动', base: 2,
      desc: '与城市本身的连接。瑞瓦肖在你皮肤下颤动。' },
    { name: '警队精神', en: 'Esprit de Corps', group: '运动', base: 1,
      desc: '身为警察的自觉。蓝色徽章的分量。' }
  ];
})(window);
