// Daily trivia: a pool of Catholic trivia questions (saints, scripture,
// Church history, liturgy, sacraments). Every question has one clearly
// correct answer and three plausible wrong ones, and every fact is a
// well-established one — no invented dates or quotes. The round is three
// questions drawn from the pool by the Eastern date, so every visitor
// gets the same three questions on a given day and a new set tomorrow,
// which is what makes a shared daily high score fair.
// Each entry: q (question), answers (four options), correct (index of
// the right answer), why (one line shown after the answer), topic.
const TRIVIA_QUESTIONS = [
  // Scripture
  { topic: 'Scripture', q: 'At the wedding in Cana, what did Jesus turn the water into?', answers: ['Wine', 'Bread', 'Oil', 'Milk'], correct: 0, why: 'John 2 tells of water turned into wine at the wedding in Cana.' },
  { topic: 'Scripture', q: 'How many books are in the Catholic Bible?', answers: ['73', '66', '70', '81'], correct: 0, why: 'The Catholic canon has 46 Old Testament books and 27 New Testament books, 73 in all.' },
  { topic: 'Scripture', q: "Which psalm begins 'The Lord is my shepherd'?", answers: ['Psalm 23', 'Psalm 1', 'Psalm 51', 'Psalm 100'], correct: 0, why: "Psalm 23 opens with 'The Lord is my shepherd, I shall not want.'" },
  { topic: 'Scripture', q: 'Who betrayed Jesus for thirty pieces of silver?', answers: ['Judas Iscariot', 'Peter', 'Thomas', 'Matthew'], correct: 0, why: 'Matthew 26 says Judas agreed to hand Jesus over for thirty pieces of silver.' },
  { topic: 'Scripture', q: 'What did Jesus use to feed the five thousand?', answers: ['Five loaves and two fish', 'Seven loaves and three fish', 'Two loaves and five fish', 'Bread and wine'], correct: 0, why: 'All four Gospels tell of five loaves and two fish feeding the crowd.' },
  { topic: 'Scripture', q: 'Who was the first pope?', answers: ['St. Peter', 'St. Paul', 'St. Linus', 'St. Clement'], correct: 0, why: 'Jesus gave Peter the keys of the kingdom in Matthew 16, and the Church counts him as the first pope.' },
  { topic: 'Scripture', q: 'How many days did Jesus fast in the desert?', answers: ['40', '30', '7', '12'], correct: 0, why: 'Matthew 4 says Jesus fasted forty days and forty nights in the desert.' },
  { topic: 'Scripture', q: 'Which Gospel tells the parable of the Good Samaritan?', answers: ['Luke', 'Matthew', 'Mark', 'John'], correct: 0, why: 'The Good Samaritan appears only in Luke 10.' },
  { topic: 'Scripture', q: 'Which book of the Bible tells the story of the Exodus?', answers: ['Exodus', 'Genesis', 'Leviticus', 'Numbers'], correct: 0, why: 'Exodus tells of Moses leading Israel out of Egypt.' },
  { topic: 'Scripture', q: 'Who was the first martyr of the Church?', answers: ['St. Stephen', 'St. Peter', 'St. Paul', 'St. James'], correct: 0, why: 'Stephen was stoned to death for his faith, as told in Acts 7.' },
  { topic: 'Scripture', q: 'What is the shortest verse in the Bible?', answers: ['Jesus wept', 'God is love', 'Pray without ceasing', 'Love your neighbor'], correct: 0, why: "John 11:35, 'Jesus wept,' is the Bible's shortest verse." },
  { topic: 'Scripture', q: 'Which woman was the first to see the risen Jesus?', answers: ['Mary Magdalene', 'Mary, the mother of Jesus', 'Martha', 'Salome'], correct: 0, why: 'John 20 says Mary Magdalene found the empty tomb and met the risen Jesus first.' },
  { topic: 'Scripture', q: 'Who wrote the most books of the New Testament?', answers: ['St. Paul', 'St. Peter', 'St. John', 'St. Luke'], correct: 0, why: "Paul's letters make up thirteen of the New Testament's twenty-seven books." },
  // Saints
  { topic: 'Saints', q: "Which saint is known as the 'Little Flower'?", answers: ['St. Thérèse of Lisieux', 'St. Teresa of Avila', 'St. Catherine of Siena', 'St. Clare'], correct: 0, why: "Thérèse of Lisieux, a Carmelite nun, is the Little Flower for her 'little way' of small acts of love." },
  { topic: 'Saints', q: 'Which saint founded the Jesuits?', answers: ['St. Ignatius of Loyola', 'St. Francis of Assisi', 'St. Dominic', 'St. Benedict'], correct: 0, why: 'Ignatius of Loyola founded the Society of Jesus in 1540.' },
  { topic: 'Saints', q: 'Which saint is the patron of lost things?', answers: ['St. Anthony of Padua', 'St. Christopher', 'St. Jude', 'St. Francis'], correct: 0, why: 'St. Anthony of Padua is called on for lost items, a devotion that goes back centuries.' },
  { topic: 'Saints', q: "Which saint wrote the 'Confessions'?", answers: ['St. Augustine', 'St. Thomas Aquinas', 'St. Jerome', 'St. Ambrose'], correct: 0, why: "Augustine's Confessions tells his journey from sin to sainthood." },
  { topic: 'Saints', q: "Which saint's feast day is March 17?", answers: ['St. Patrick', 'St. Joseph', 'St. Brigid', 'St. Columba'], correct: 0, why: 'March 17 is the feast of St. Patrick, apostle of Ireland.' },
  { topic: 'Saints', q: 'Which saint was the first person born in the United States to be canonized?', answers: ['St. Elizabeth Ann Seton', 'St. Frances Xavier Cabrini', 'St. Kateri Tekakwitha', 'St. John Neumann'], correct: 0, why: 'Elizabeth Ann Seton, canonized in 1975, was the first native-born American saint.' },
  { topic: 'Saints', q: "Which saint is known as the 'Apostle to the Germans'?", answers: ['St. Boniface', 'St. Augustine', 'St. Patrick', 'St. Columba'], correct: 0, why: 'Boniface, an English monk, carried the Gospel to the Germanic peoples in the 8th century.' },
  { topic: 'Saints', q: "Which saint is known as the 'Apostle of Rome'?", answers: ['St. Philip Neri', 'St. Francis of Assisi', 'St. Dominic', 'St. Benedict'], correct: 0, why: 'Philip Neri, founder of the Oratory, is called the Apostle of Rome.' },
  { topic: 'Saints', q: 'Which saint founded the Poor Clares?', answers: ['St. Clare', 'St. Teresa of Avila', 'St. Catherine of Siena', 'St. Brigid'], correct: 0, why: 'Clare of Assisi founded the Order of Poor Ladies, the Poor Clares, in 1212.' },
  { topic: 'Saints', q: 'Which saint translated the Bible into Latin?', answers: ['St. Jerome', 'St. Augustine', 'St. Ambrose', 'St. Gregory the Great'], correct: 0, why: "Jerome's Latin Vulgate was the Church's Bible for over a thousand years." },
  { topic: 'Saints', q: 'Which saint founded the Franciscan order?', answers: ['St. Francis of Assisi', 'St. Dominic', 'St. Benedict', 'St. Clare'], correct: 0, why: 'Francis of Assisi founded the Order of Friars Minor, the Franciscans.' },
  // Church history
  { topic: 'Church history', q: 'In which year did the Second Vatican Council open?', answers: ['1962', '1958', '1965', '1970'], correct: 0, why: 'Vatican II opened on 11 October 1962 under Pope John XXIII.' },
  { topic: 'Church history', q: 'Which pope called the Second Vatican Council?', answers: ['Pope John XXIII', 'Pope Pius XII', 'Pope Paul VI', 'Pope John Paul II'], correct: 0, why: 'John XXIII announced the council in 1959 and opened it in 1962.' },
  { topic: 'Church history', q: 'Which council in 325 affirmed that Jesus is of the same substance as the Father?', answers: ['The Council of Nicaea', 'The Council of Chalcedon', 'The Council of Trent', 'The Council of Ephesus'], correct: 0, why: 'Nicaea in 325 produced the first part of the Nicene Creed.' },
  { topic: 'Church history', q: 'In which year did the Second Vatican Council close?', answers: ['1965', '1962', '1963', '1968'], correct: 0, why: 'Vatican II closed on 8 December 1965 under Pope Paul VI.' },
  { topic: 'Church history', q: 'Which pope reigned the longest in modern times?', answers: ['Pope Pius IX', 'Pope John Paul II', 'Pope Leo XIII', 'Pope Pius XII'], correct: 0, why: 'Pius IX reigned from 1846 to 1878, over 31 years.' },
  { topic: 'Church history', q: 'In which city did the Council of Trent meet?', answers: ['Trent', 'Rome', 'Florence', 'Milan'], correct: 0, why: 'The Council of Trent met in Trent, in northern Italy, from 1545 to 1563.' },
  { topic: 'Church history', q: 'In which year did the Great Schism split East and West?', answers: ['1054', '1204', '1517', '325'], correct: 0, why: 'The mutual excommunications of 1054 split the Catholic and Orthodox Churches.' },
  { topic: 'Church history', q: 'How many popes have taken the name John Paul?', answers: ['Two', 'One', 'Three', 'Four'], correct: 0, why: 'John Paul I (1978) and John Paul II (1978–2005) are the only two.' },
  { topic: 'Church history', q: 'Which city did St. Peter travel to, where he was martyred and is buried?', answers: ['Rome', 'Jerusalem', 'Antioch', 'Alexandria'], correct: 0, why: "Peter went to Rome, where he was crucified and is buried under St. Peter's Basilica." },
  // Liturgy
  { topic: 'Liturgy', q: 'What colour are vestments on Good Friday?', answers: ['Red', 'Purple', 'White', 'Black'], correct: 0, why: 'Red marks the blood of Christ on Good Friday and feasts of martyrs.' },
  { topic: 'Liturgy', q: 'What colour are vestments during Advent?', answers: ['Purple', 'Red', 'White', 'Green'], correct: 0, why: 'Purple marks the penitential seasons of Advent and Lent.' },
  { topic: 'Liturgy', q: 'On which day of the week does the Church celebrate the Resurrection?', answers: ['Sunday', 'Saturday', 'Friday', 'Monday'], correct: 0, why: 'Every Sunday is a little Easter, the day of the Resurrection.' },
  { topic: 'Liturgy', q: 'During which part of the Mass are the bread and wine consecrated?', answers: ['The Liturgy of the Eucharist', 'The Liturgy of the Word', 'The Introductory Rites', 'The Concluding Rites'], correct: 0, why: 'The bread and wine become the Body and Blood of Christ in the Liturgy of the Eucharist.' },
  { topic: 'Liturgy', q: 'What is the first season of the liturgical year?', answers: ['Advent', 'Lent', 'Easter', 'Ordinary Time'], correct: 0, why: 'The liturgical year begins with the first Sunday of Advent.' },
  { topic: 'Liturgy', q: 'How many candles are on an Advent wreath?', answers: ['Four', 'Three', 'Five', 'Seven'], correct: 0, why: 'Four candles mark the four Sundays of Advent.' },
  { topic: 'Liturgy', q: 'On which day does Lent begin?', answers: ['Ash Wednesday', 'Good Friday', 'Palm Sunday', 'Holy Thursday'], correct: 0, why: 'Lent opens with Ash Wednesday and the marking of ashes.' },
  { topic: 'Liturgy', q: 'In the Mass, the readings and homily belong to which part?', answers: ['The Liturgy of the Word', 'The Liturgy of the Eucharist', 'The Introductory Rites', 'The Concluding Rites'], correct: 0, why: 'The Liturgy of the Word is the readings, psalm, Gospel and homily.' },
  { topic: 'Liturgy', q: 'What does the priest say at the start of Mass?', answers: ['In the name of the Father, and of the Son, and of the Holy Spirit', 'The Lord be with you', 'Go in peace', 'Lift up your hearts'], correct: 0, why: 'Mass opens with the sign of the cross and those words.' },
  { topic: 'Liturgy', q: 'How many Sundays are in Lent?', answers: ['Six', 'Four', 'Five', 'Seven'], correct: 0, why: 'Lent has six Sundays, which are not counted among the forty days of fasting.' },
  // Sacraments
  { topic: 'Sacraments', q: 'How many sacraments are there?', answers: ['Seven', 'Five', 'Ten', 'Three'], correct: 0, why: 'Baptism, Confirmation, Eucharist, Penance, Anointing of the Sick, Holy Orders and Matrimony.' },
  { topic: 'Sacraments', q: 'Which sacrament is usually the first one received?', answers: ['Baptism', 'Confirmation', 'Eucharist', 'Penance'], correct: 0, why: 'Baptism is the door to the other sacraments.' },
  { topic: 'Sacraments', q: 'Which sacrament forgives sins after Baptism?', answers: ['Penance', 'Anointing of the Sick', 'Confirmation', 'Matrimony'], correct: 0, why: 'Penance, also called Reconciliation or Confession, restores the grace lost by sin.' },
  { topic: 'Sacraments', q: 'Which sacrament ordains priests?', answers: ['Holy Orders', 'Confirmation', 'Matrimony', 'Anointing of the Sick'], correct: 0, why: 'Holy Orders ordains deacons, priests and bishops.' },
  { topic: 'Sacraments', q: 'Which sacrament joins a man and a woman in marriage?', answers: ['Matrimony', 'Holy Orders', 'Confirmation', 'Baptism'], correct: 0, why: 'Matrimony is the sacrament of marriage.' },
  { topic: 'Sacraments', q: 'What oil is used in Confirmation?', answers: ['Chrism', 'Baptismal water', 'Incense', 'Holy water'], correct: 0, why: 'Chrism, olive oil mixed with balsam and blessed by the bishop, is used in Confirmation.' },
  { topic: 'Sacraments', q: 'Which sacrament anoints the sick?', answers: ['Anointing of the Sick', 'Baptism', 'Penance', 'Eucharist'], correct: 0, why: 'Anointing of the Sick gives strength and healing to the seriously ill.' },
];

// Eastern date (YYYY-MM-DD), so the round turns over at midnight for the
// US audience, matching the verse of the day.
function easternDateStr(d = new Date()) {
  const parts = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').map(Number);
  return `${parts[2]}-${String(parts[0]).padStart(2, '0')}-${String(parts[1]).padStart(2, '0')}`;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Today's round: three questions drawn from the pool by the Eastern date.
// Same three for every visitor on a given day, a new set tomorrow. The
// draw is re-rolled (deterministically, by salting the seed) when all
// three would come from one topic, so a day never reads as a single-topic
// quiz.
function dailyTriviaQuestions(dateStr = easternDateStr()) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const rand = mulberry32(hashStr('trivia-' + dateStr + (attempt ? '-' + attempt : '')));
    const idx = TRIVIA_QUESTIONS.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const questions = idx.slice(0, 3).map((i) => TRIVIA_QUESTIONS[i]);
    if (new Set(questions.map((q) => q.topic)).size > 1) return { date: dateStr, questions };
  }
  return { date: dateStr, questions: TRIVIA_QUESTIONS.slice(0, 3) };
}

module.exports = { TRIVIA_QUESTIONS, easternDateStr, dailyTriviaQuestions };
