// ========================================
//  AR 環保小尖兵 - 優化版 v3.0
//  v3.0 修正項目：
//  1. 提高手勢閾值，減少誤判（1.5 → 1.7）
//  2. 廚餘（握拳）加入正向確認機制，避免與「準備」混淆
//  3. 拇指偵測改用橫向距離（不再用 wrist 距離），提高「一般」手勢準確率
//  4. 穩定幀數從 3 提升至 6，需連續 6 幀才觸發
//  5. 修正 lastStabilizedGesture 在 cooldown 期間被錯誤清零的 bug
//  6. 新增手勢信心度顯示，讓玩家更容易校正姿勢
//  7. 各手勢加入更嚴格的互斥條件
// ========================================

let video;
let handPose;
let hands = [];
let logoX, logoY;
let items = [];
let score = 0;
let gameState = "START"; // START, PLAY, OVER
let isModelReady = false;
let gameTimer = 30;
let lastTimeCheck = 0;

// 💡 v3 修正：分開管理「目前穩定手勢」與「供 spawnTrash 用的手勢」
//    lastStabilizedGesture 只在非 cooldown 期間更新，避免 cooldown 時被清零
let lastStabilizedGesture = "NONE";

let feedbackText = { txt: "", x: 0, y: 0, timer: 0, color: "#fff" };

// 手勢 cooldown
let gestureCooldown = 0;
const GESTURE_COOLDOWN_FRAMES = 20;

// 💡 v3 修正：穩定幀數從 3 提升至 6，大幅降低誤判
let gestureBuffer = [];
const GESTURE_CONFIRM_FRAMES = 6;

// 垃圾資料庫
const TRASH_DATABASE = [
  { name: "🍌 香蕉皮", type: "廚餘" },
  { name: "🍾 寶特瓶", type: "回收" },
  { name: "📦 舊紙箱", type: "回收" },
  { name: "🧻 衛生紙", type: "一般" },
  { name: "🍖 剩骨頭", type: "廚餘" },
  { name: "🔋 舊電池", type: "回收" },
  { name: "🥡 塑膠袋", type: "一般" },
  { name: "🥬 爛菜葉", type: "廚餘" },
  { name: "📰 舊報紙", type: "回收" },
  { name: "🧴 洗髮精瓶", type: "回收" },
];

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  video = createCapture(VIDEO);
  video.size(320, 240);

  handPose = ml5.handPose({ flipped: true }, () => {
    console.log("HandPose Model Loaded!");
    handPose.detectStart(video, (results) => {
      hands = results;
      isModelReady = true;
    });
  });

  video.hide();

  setInterval(spawnTrash, 150);

  logoX = width / 2;
  logoY = height / 2;
}

function draw() {
  background(20, 25, 35);

  if (gameState === "START") {
    cursor(ARROW);
    drawStartScreen();
  } else if (gameState === "PLAY" || gameState === "OVER") {
    noCursor();
    drawGame();
    updateTimer();
  } else if (gameState === "OVER") {
    cursor(ARROW);
    drawOverScreen();
  }

  if (gameState === "PLAY") {
    updateTimer();
  }

  drawCameraPreview();

  // 得分回饋浮字
  if (feedbackText.timer > 0) {
    let alpha = map(feedbackText.timer, 0, 50, 0, 255);
    let rise = map(feedbackText.timer, 50, 0, 0, 40);
    push();
    textFont("monospace");
    textSize(38);
    textAlign(CENTER);
    fill(0, alpha * 0.6);
    text(feedbackText.txt, feedbackText.x + 2, feedbackText.y - rise + 2);
    let c = color(feedbackText.color);
    c.setAlpha(alpha);
    fill(c);
    text(feedbackText.txt, feedbackText.x, feedbackText.y - rise);
    pop();
    feedbackText.timer--;
  }

  if (!isModelReady) {
    drawLoadingOverlay();
  }
}

// ── 攝影機預覽 ────────────────────────────────────────
function drawCameraPreview() {
  let previewW = min(180, width * 0.25);
  let previewH = previewW * 0.75;
  let previewX = width - previewW - 15;
  let previewY = 15;

  push();
  translate(previewX, previewY);
  push();
  translate(previewW, 0);
  scale(-1, 1);
  image(video, 0, 0, previewW, previewH);
  pop();
  noFill();
  stroke(255, 100);
  strokeWeight(1.5);
  rect(0, 0, previewW, previewH, 4);
  fill(0, 180);
  noStroke();
  rect(0, previewH - 22, previewW, 22, 0, 0, 4, 4);
  fill(255, 200);
  textSize(previewW * 0.06);
  textAlign(CENTER, CENTER);
  text("📷 攝影機預覽", previewW / 2, previewH - 11);
  pop();
}

// ── 模型載入遮罩 ──────────────────────────────────────
function drawLoadingOverlay() {
  fill(0, 0, 0, 160);
  noStroke();
  rect(0, 0, width, height);
  fill(255);
  textSize(22);
  textAlign(CENTER, CENTER);
  text("🤖 AI 模型載入中，請稍候...", width / 2, height / 2);
  let dots = ".".repeat(floor(frameCount / 20) % 4);
  textSize(16);
  fill(180);
  text(dots, width / 2, height / 2 + 35);
}

// ── 垃圾生成 ─────────────────────────────────────────
function spawnTrash() {
  if (gameState !== "PLAY") return;
  if (items.length > 0) return;
  if (lastStabilizedGesture !== "準備") return;

  let baseData = random(TRASH_DATABASE);
  items.push({
    name: baseData.name,
    type: baseData.type,
    x: random(80, width - 80),
    y: -60,
    speed: random(1.8, 3.2),
    classified: false,
  });
}

// ── 遊戲主畫面 ────────────────────────────────────────
function drawGame() {
  drawBins();

  let currentGesture = "NONE";
  let debugInfo = { rawGesture: "NONE", bufferMatch: false };

  if (hands && hands.length > 0 && hands[0].keypoints) {
    let hand = hands[0];
    let palmCenter = hand.keypoints[9];

    if (palmCenter && palmCenter.x !== undefined) {
      let targetX = map(palmCenter.x, 0, 320, 0, width);
      let targetY = map(palmCenter.y, 0, 240, 0, height);
      logoX = lerp(logoX, targetX, 0.3);
      logoY = lerp(logoY, targetY, 0.3);
    }

    let rawGesture = detectGesture(hand);
    debugInfo.rawGesture = rawGesture;

    gestureBuffer.push(rawGesture);
    if (gestureBuffer.length > GESTURE_CONFIRM_FRAMES) {
      gestureBuffer.shift();
    }

    if (
      gestureBuffer.length === GESTURE_CONFIRM_FRAMES &&
      gestureBuffer.every((g) => g === rawGesture) &&
      rawGesture !== "NONE"
    ) {
      currentGesture = rawGesture;
      debugInfo.bufferMatch = true;
    }
  } else {
    gestureBuffer = [];
  }

  // 💡 v3 核心修正：只在非 cooldown 狀態下更新 lastStabilizedGesture
  //    原版在 cooldown 期間 currentGesture 被設為 "NONE"，導致 lastStabilizedGesture
  //    被錯誤更新，造成下一個垃圾無法生成
  if (gestureCooldown <= 0) {
    lastStabilizedGesture = currentGesture;
  }

  if (gestureCooldown > 0) {
    gestureCooldown--;
    currentGesture = "NONE";
  }

  // ── 處理垃圾物件 ──────────────────────────────────
  for (let i = items.length - 1; i >= 0; i--) {
    let item = items[i];

    if (currentGesture !== "NONE" && !item.classified && item.y > 0) {
      item.classified = true;
      checkClassification(item, currentGesture);
      gestureCooldown = GESTURE_COOLDOWN_FRAMES;
      items.splice(i, 1);
      continue;
    }

    item.y += item.speed;

    if (item.y > height + 60) {
      showFeedback("💨 逃跑了！", item.x, height - 100, "#FF9800");
      items.splice(i, 1);
      continue;
    }

    push();
    textSize(32);
    textAlign(CENTER, CENTER);
    fill(0, 120);
    text(item.name, item.x + 2, item.y + 2);
    fill(255);
    text(item.name, item.x, item.y);
    pop();
  }

  if (items.length === 0) {
    push();
    textAlign(CENTER, CENTER);
    fill(255, 200, 0);
    textSize(24);
    text("☝️ 比出食指，召喚下一個垃圾！", width / 2, height / 2 + 80);
    pop();
  }

  drawHandCursor(currentGesture, debugInfo);
  drawUI();
}

// ── 手部游標（含偵測狀態提示）──────────────────────────
function drawHandCursor(gesture, debugInfo) {
  push();
  let cursorColor =
    gesture === "回收"
      ? color(33, 150, 243)
      : gesture === "一般"
      ? color(158, 158, 158)
      : gesture === "廚餘"
      ? color(76, 175, 80)
      : gesture === "準備"
      ? color(255, 200, 0)
      : color(255, 255, 255, 150);
  
  let baseSize = min(width, height) * 0.08;
  textSize(baseSize);
  textAlign(CENTER, CENTER);
  fill(gesture !== "NONE" ? cursorColor : color(255, 100));
  text(gesture !== "NONE" ? "👉 " + gesture : "等待手勢...", width / 2, height / 2);

  // 💡 v3 新增：在偵測到原始手勢但尚未穩定時，顯示「穩定中...」提示
  //    讓玩家知道系統有偵測到手，只是還在等待確認
  if (debugInfo && debugInfo.rawGesture !== "NONE" && gesture === "NONE") {
    let confirmedCount = gestureBuffer.filter(g => g === debugInfo.rawGesture).length;
    let progressPct = confirmedCount / GESTURE_CONFIRM_FRAMES;
    textSize(16);
    fill(255, 200, 0, 180);
    text(
      "穩定中 " + debugInfo.rawGesture + " [" + confirmedCount + "/" + GESTURE_CONFIRM_FRAMES + "]",
      width / 2,
      height / 2 + 40
    );
    // 進度條
    noFill();
    stroke(255, 200, 0, 80);
    strokeWeight(2);
    rect(width / 2 - 80, height / 2 + 55, 160, 8, 4);
    fill(255, 200, 0, 180);
    noStroke();
    rect(width / 2 - 80, height / 2 + 55, 160 * progressPct, 8, 4);
  }
  pop();
}

// ── 手勢偵測（v3 重寫核心邏輯）──────────────────────────
function detectGesture(hand) {
  let wrist    = hand.keypoints[0];
  let thumb    = hand.keypoints[4];  // 拇指尖
  let thumbMCP = hand.keypoints[2];  // 拇指第二節（掌側）
  let index    = hand.keypoints[8];  // 食指尖
  let middle   = hand.keypoints[12]; // 中指尖
  let ring     = hand.keypoints[16]; // 無名指尖
  let pinky    = hand.keypoints[20]; // 小指尖
  let indexBase  = hand.keypoints[5];  // 食指根
  let middleBase = hand.keypoints[9];  // 中指根
  let ringBase   = hand.keypoints[13]; // 無名指根
  let pinkyBase  = hand.keypoints[17]; // 小指根

  if (!wrist || !thumb || !index || !middle || !ring || !pinky ||
      !indexBase || !middleBase || !ringBase || !pinkyBase || !thumbMCP) {
    return "NONE";
  }

  // 以食指根部到手腕的距離作為參考長度
  let ref = dist(indexBase.x, indexBase.y, wrist.x, wrist.y);
  if (ref < 10) return "NONE"; // 手太近或偵測異常

  // 各指尖到手腕的距離
  let dIndex  = dist(index.x,  index.y,  wrist.x, wrist.y);
  let dMiddle = dist(middle.x, middle.y, wrist.x, wrist.y);
  let dRing   = dist(ring.x,   ring.y,   wrist.x, wrist.y);
  let dPinky  = dist(pinky.x,  pinky.y,  wrist.x, wrist.y);

  // 💡 v3 修正：提高閾值至 1.7（原 1.5），減少誤判
  //    只有手指明確伸長時才算「伸直」
  const EXT_THRESHOLD  = 1.7; // 伸直閾值（距離 > ref * 1.7）
  const CURL_THRESHOLD = 1.1; // 彎曲閾值（距離 < ref * 1.1）

  let indexExt  = dIndex  > ref * EXT_THRESHOLD;
  let middleExt = dMiddle > ref * EXT_THRESHOLD;
  let ringExt   = dRing   > ref * EXT_THRESHOLD;
  let pinkyExt  = dPinky  > ref * EXT_THRESHOLD;

  // 嚴格彎曲：距離明確小於閾值
  let indexCurl  = dIndex  < ref * CURL_THRESHOLD;
  let middleCurl = dMiddle < ref * CURL_THRESHOLD;
  let ringCurl   = dRing   < ref * CURL_THRESHOLD;
  let pinkyCurl  = dPinky  < ref * CURL_THRESHOLD;

  // 💡 v3 修正：拇指改用橫向偏移偵測
  //    拇指伸直方向不同於其他手指（朝側邊），
  //    改比較拇指尖與食指掌骨根（keypoint 5）的水平距離
  //    數值為正代表拇指朝外（左手朝左，右手朝右）
  let thumbHorizDist = abs(thumb.x - indexBase.x);
  let thumbExt = thumbHorizDist > ref * 0.9 && !indexExt;
  //    額外確認：拇指尖比拇指第二節更偏外側
  let thumbMoreExt = thumbHorizDist > dist(thumbMCP.x, thumbMCP.y, indexBase.x, indexBase.y);
  thumbExt = thumbExt && thumbMoreExt;

  // ────────────────────────────────────
  // 手勢判定（由嚴格到寬鬆排列，避免短路誤判）
  // ────────────────────────────────────

  // ✌️ 回收：食指+中指伸直，無名+小指明確彎曲，拇指不伸
  // 加入正向確認（ringCurl + pinkyCurl），避免手指半開時誤判
  if (indexExt && middleExt && ringCurl && pinkyCurl && !thumbExt) {
    return "回收";
  }

  // ☝️ 準備：只有食指伸直，其餘明確彎曲
  // 加入嚴格條件：中指、無名、小指都必須明確縮短
  if (indexExt && middleCurl && ringCurl && pinkyCurl && !thumbExt) {
    return "準備";
  }

  // 👍 一般：大拇指橫向伸出，其餘手指彎曲
  // 加入正向確認（其餘四指都必須不是伸直狀態）
  if (thumbExt && !indexExt && !middleExt && !ringExt && !pinkyExt) {
    return "一般";
  }

  // ✊ 廚餘：握拳，所有手指明確縮短
  // 💡 v3 修正：從「全部不伸直」改為「全部明確彎曲」，避免手指半開時誤判為廚餘
  if (indexCurl && middleCurl && ringCurl && pinkyCurl && !thumbExt) {
    return "廚餘";
  }

  // 無法辨識
  return "NONE";
}

// ── 分類判定 ──────────────────────────────────────────
function checkClassification(item, playerChoice) {
  if (item.type === playerChoice) {
    score += 10;
    showFeedback("✅ +10", item.x, item.y, "#4CAF50");
  } else {
    showFeedback("❌ 分類錯誤！", item.x, item.y, "#F44336");
  }
}

function showFeedback(txt, x, y, colorStr) {
  feedbackText = { txt, x, y, timer: 50, color: colorStr };
}

// ── 垃圾桶背景 ────────────────────────────────────────
function drawBins() {
  let binH = 80;
  let binW = width / 3;

  noStroke();
  fill(33, 150, 243, 120);
  rect(0, height - binH, binW, binH, 8, 8, 0, 0);
  fill(120, 120, 120, 120);
  rect(binW, height - binH, binW, binH, 8, 8, 0, 0);
  fill(76, 175, 80, 120);
  rect(binW * 2, height - binH, binW, binH, 8, 8, 0, 0);

  stroke(255, 40);
  strokeWeight(1);
  line(binW, height - binH, binW, height);
  line(binW * 2, height - binH, binW * 2, height);

  fill(255);
  noStroke();
  textSize(18);
  textAlign(CENTER, CENTER);
  text("✌️ 資源回收", binW / 2, height - binH / 2);
  text("👍 一般垃圾", binW * 1.5, height - binH / 2);
  text("✊ 廚餘桶", binW * 2.5, height - binH / 2);
}

// ── HUD / UI ─────────────────────────────────────────
function drawUI() {
  let uiW = min(155, width * 0.3);
  fill(0, 0, 0, 180);
  noStroke();
  rect(15, 15, uiW, 50, 8);
  fill(255);
  textSize(uiW * 0.15);
  textAlign(LEFT, CENTER);
  text("🏆 " + score + " 分", 30, 40);

  let timeColor = gameTimer <= 10 ? color(255, 87, 34) : color(255);
  fill(0, 0, 0, 180);
  noStroke();
  rect(15, 75, uiW, 50, 8);
  fill(timeColor);
  textSize(uiW * 0.15);
  textAlign(LEFT, CENTER);
  if (gameTimer <= 10 && frameCount % 30 < 15) {
    fill(255, 87, 34);
  }
  text("⏱ " + gameTimer + "s", 30, 100);
}

// ── 計時器 ────────────────────────────────────────────
function updateTimer() {
  if (millis() - lastTimeCheck >= 1000) {
    gameTimer--;
    lastTimeCheck = millis();
    if (gameTimer <= 0) {
      gameTimer = 0;
      gameState = "OVER";
      cursor(ARROW);
    }
  }
}

// ── 開始畫面 ──────────────────────────────────────────
function drawStartScreen() {
  for (let y = 0; y < height; y += 2) {
    let c = lerpColor(color(10, 20, 40), color(20, 50, 30), y / height);
    stroke(c);
    line(0, y, width, y);
  }

  let titleSize = min(46, width * 0.08);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(titleSize);
  fill("#FFEB3B");
  text("🌟 AR 環保小尖兵 🌟", width / 2, height / 2 - 130);

  textSize(titleSize * 0.4);
  fill(180, 230, 180);
  text("用手勢拯救地球！", width / 2, height / 2 - 88);

  let boxW = min(400, width * 0.9);
  fill(0, 0, 0, 160);
  rect(width / 2 - boxW / 2, height / 2 - 65, boxW, 185, 12);

  let contentSize = min(18, width * 0.04);
  fill(220);
  textSize(contentSize * 1.1);
  text("【操作指南】", width / 2, height / 2 - 42);

  textSize(contentSize);
  fill(255);
  text("看到垃圾掉落時，比出對應手勢即可分類：", width / 2, height / 2 - 12);

  textSize(contentSize * 1.2);
  fill("#FFC107");
  text("☝️  食指 → 召喚垃圾", width / 2, height / 2 + 20);
  fill("#64B5F6");
  text("✌️  兩指 → 資源回收", width / 2, height / 2 + 48);
  fill("#BDBDBD");
  text("👍  拇指 → 一般垃圾", width / 2, height / 2 + 76);
  fill("#81C784");
  text("✊  握拳 → 廚餘桶", width / 2, height / 2 + 104);

  if (!isModelReady) {
    fill(255, 165, 0, 180);
    rect(width / 2 - 130, height / 2 + 125, 260, 50, 25);
    fill(40);
    textSize(18);
    text("⏳ 模型載入中...", width / 2, height / 2 + 150);
  } else {
    let btnX = width / 2 - 90;
    let btnY = height / 2 + 125;
    let isHover = mouseX > btnX && mouseX < btnX + 180 && mouseY > btnY && mouseY < btnY + 50;

    if (isHover) cursor(HAND);

    push();
    translate(width / 2, height / 2 + 150);
    if (isHover && mouseIsPressed) scale(0.92);
    else if (isHover) scale(1.06);

    drawingContext.shadowBlur = isHover ? 20 : 10;
    drawingContext.shadowColor = isHover ? color(76, 175, 80) : color(0, 0, 0, 100);

    fill(isHover ? color(90, 195, 95) : color(76, 175, 80));
    noStroke();
    rect(-90, -25, 180, 50, 25);

    drawingContext.shadowBlur = 0;
    fill(255);
    textSize(22);
    text("開始挑戰 🚀", 0, 0);
    pop();
  }
}

// ── 結束畫面 ──────────────────────────────────────────
function drawOverScreen() {
  fill(0, 0, 0, 200);
  noStroke();
  rect(0, 0, width, height);

  textAlign(CENTER, CENTER);

  textSize(min(48, width * 0.1));
  fill("#FFEB3B");
  text("⏳ 挑戰結束！", width / 2, height / 2 - 110);

  textSize(min(32, width * 0.07));
  fill(255);
  text("你的最終得分：" + score + " 分", width / 2, height / 2 - 50);

  let stars, comment;
  if (score >= 150) {
    stars = "⭐⭐⭐";
    comment = "太厲害了！你簡直是環保大師！";
  } else if (score >= 80) {
    stars = "⭐⭐";
    comment = "做得好！地球感謝你的付出！";
  } else if (score >= 30) {
    stars = "⭐";
    comment = "繼續加油！多練習分類可以拯救更多綠地！";
  } else {
    stars = "🌱";
    comment = "從零開始學習，每一步都有意義！";
  }

  textSize(36);
  fill("#FFEB3B");
  text(stars, width / 2, height / 2 + 5);

  textSize(20);
  fill(180);
  text(comment, width / 2, height / 2 + 55);

  let btnX = width / 2 - 90;
  let btnY = height / 2 + 110;
  let isHover = mouseX > btnX && mouseX < btnX + 180 && mouseY > btnY && mouseY < btnY + 50;

  if (isHover) cursor(HAND);

  push();
  translate(width / 2, height / 2 + 135);
  if (isHover && mouseIsPressed) scale(0.92);
  else if (isHover) scale(1.06);

  drawingContext.shadowBlur = isHover ? 20 : 10;
  drawingContext.shadowColor = isHover ? color(33, 150, 243) : color(0, 0, 0, 100);

  fill(isHover ? color(64, 168, 245) : color(33, 150, 243));
  noStroke();
  rect(-90, -25, 180, 50, 25);

  drawingContext.shadowBlur = 0;
  fill(255);
  textSize(22);
  text("再玩一次 🔄", 0, 0);
  pop();
}

// ── 滑鼠點擊 ──────────────────────────────────────────
function mousePressed() {
  handleInput();
}

// ── 觸控支援 ──────────────────────────────────────────
function touchStarted() {
  handleInput();
  return false; // 防止螢幕捲動
}

function handleInput() {
  if (gameState === "START") {
    if (!isModelReady) return;
    if (
      mouseX > width / 2 - 100 && mouseX < width / 2 + 100 &&
      mouseY > height / 2 + 120 && mouseY < height / 2 + 180
    ) {
      resetGame();
    }
  } else if (gameState === "OVER") {
    if (
      mouseX > width / 2 - 100 && mouseX < width / 2 + 100 &&
      mouseY > height / 2 + 105 && mouseY < height / 2 + 165
    ) {
      resetGame();
    }
  }
}

// ── 重置遊戲 ──────────────────────────────────────────
function resetGame() {
  score = 0;
  gameTimer = 30;
  items = [];
  gestureBuffer = [];
  gestureCooldown = 0;
  lastStabilizedGesture = "NONE";
  lastTimeCheck = millis();
  feedbackText = { txt: "", x: 0, y: 0, timer: 0, color: "#fff" };
  gameState = "PLAY";
}

// ── 視窗縮放 ──────────────────────────────────────────
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  logoX = width / 2;
  logoY = height / 2;
}