let video;
let handPose;
let hands = [];
let logoX = 200, logoY = 200; 
let items = []; 
let score = 0;
let gameState = "START"; // START, PLAY, OVER
let isModelReady = false; // 💡 新增：追蹤模型是否準備好
let grabbedItem = null; 
let gameTimer = 30; // 遊戲時間 30 秒
let lastTimeCheck = 0;
let feedbackText = { txt: "", x: 0, y: 0, timer: 0, color: "#fff" }; // 💡 新增：得分回饋文字

// 垃圾資料庫
const TRASH_DATABASE = [
  { name: "🍌 香蕉皮", type: "廚餘" },
  { name: "🍾 寶特瓶", type: "回收" },
  { name: "📦 舊紙箱", type: "回收" },
  { name: "🧻 衛生紙", type: "一般" },
  { name: "🍖 剩骨頭", type: "廚餘" },
  { name: "🔋 舊電池", type: "回收" },
  { name: "🥡 塑膠袋", type: "一般" }
];

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1); // 💡 優化 1：強制 1:1 像素密度。在高解析度螢幕上能顯著提升效能
  
  // 💡 優化 2：降低偵測解析度至 320x240。這會大幅減輕 AI 運算負擔，且不影響偵測準確度
  video = createCapture(VIDEO);
  video.size(320, 240);
  
  // 💡 修正 1：使用 detectStart 讓偵測更流暢，並確保座標與畫面同步翻轉
  handPose = ml5.handPose({ flipped: true }, () => {
    console.log("Model Loaded!");
    handPose.detectStart(video, (results) => { hands = results; isModelReady = true; });
  });
  
  video.hide(); 
  
  // 每 1.2 秒生成一個垃圾
  setInterval(spawnTrash, 1200);
  
  // 初始化座標，避免 undefined 造成計算錯誤
  logoX = width / 2;
  logoY = height / 2;
}

// 💡 修正 2：當模型載入完成後執行的 function
function modelLoaded() {
  console.log("Model Loaded!");
  isModelReady = true; // 💡 標記模型已就緒
}

function draw() {
  background(0); // 💡 確保在任何東西畫出來前，畫面不是白的


  // 1. 繪製鏡像視訊作為背景
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height); // 這裡會自動縮放視訊到全螢幕
  pop();
  
  // 在視訊上方蓋一層半透明黑底，防止視訊背景太亮吃掉遊戲畫面
  fill(0, 0, 0, 80); 
  rect(0, 0, width, height);
  
  // 💡 繪製得分回饋特效
  if (feedbackText.timer > 0) {
    fill(feedbackText.color);
    textSize(40);
    textAlign(CENTER);
    text(feedbackText.txt, feedbackText.x, feedbackText.y - (50 - feedbackText.timer));
    feedbackText.timer--;
  }

  // 如果模型還沒準備好，顯示提示文字
  if (!isModelReady) {
    fill(255);
    textAlign(CENTER, CENTER);
    text("AI 模型載入中，請稍候...", width/2, height/2);
  }

  // 2. 根據遊戲狀態渲染畫面
  if (gameState === "START") {
    drawStartScreen();
  } else if (gameState === "PLAY") {
    drawGame();
    updateTimer();
  } else if (gameState === "OVER") {
    drawOverScreen();
  }
}

function spawnTrash() {
  if (gameState !== "PLAY") return;
  let baseData = random(TRASH_DATABASE);
  items.push({
    name: baseData.name,
    type: baseData.type,
    x: random(50, width - 50),
    y: -50, 
    speed: random(3, 5) 
  });
}

function drawGame() {
  drawBins();
  
  let isFist = false;

  // 💡 修正 4：極其嚴格的安全性檢查，防止座標 undefined 造成黑畫面
  if (hands && hands.length > 0 && hands[0].keypoints) {
    let hand = hands[0];
    
    // 💡 修正：使用中指指根 (keypoint 9) 作為手掌中心，鎖定紅點位置
    let palmCenter = hand.keypoints[9]; 
    if (palmCenter && palmCenter.x !== undefined) {
      let targetX = map(palmCenter.x, 0, 320, 0, width);
      let targetY = map(palmCenter.y, 0, 240, 0, height);
      // 💡 優化：再次提高 lerp 係數 (0.8 -> 0.95)，讓追蹤近乎即時
      logoX = lerp(logoX, targetX, 0.95);
      logoY = lerp(logoY, targetY, 0.95);
    }

    let indexTip = hand.keypoints[8];
    let middleTip = hand.keypoints[12];
    
    if (palmCenter && indexTip && middleTip && indexTip.x !== undefined) {
      let d1 = dist(indexTip.x, indexTip.y, palmCenter.x, palmCenter.y);
      let d2 = dist(middleTip.x, middleTip.y, palmCenter.x, palmCenter.y);
      // 💡 優化：放寬握拳判定門檻 (35 -> 45)，讓抓取更輕鬆
      if ((d1 + d2) / 2 < 45) isFist = true; 
    }
  } else {
    // 沒偵測到手時的滑鼠模擬
    logoX = mouseX;
    logoY = mouseY;
    isFist = mouseIsPressed;
  }

  // 檢查是否瞄準到任何垃圾，用於視覺回饋
  let isHovering = items.some(item => dist(logoX, logoY, item.x, item.y) < 100);

  // 繪製互動指引外圈
  noFill();
  stroke(isFist ? "#FFEB3B" : "#F44336"); // 改用字串顏色更安全
  // 💡 優化：瞄準到垃圾時外圈會擴大並加粗，提示可以抓取
  strokeWeight(isHovering ? 5 : 3);
  let ringSize = isHovering ? 60 : 45;
  ellipse(logoX, logoY, ringSize, ringSize);

  // 核心互動點
  fill(isFist ? "#FFEB3B" : "#F44336"); 
  noStroke();
  ellipse(logoX, logoY, 15, 15); 
  
  // 處理垃圾與碰撞
  for (let i = items.length - 1; i >= 0; i--) {
    let item = items[i];

    if (item === grabbedItem) {
      // 💡 優化：增加跟隨速度 (0.7 -> 0.9)，減少拖泥帶水的延遲感
      item.x = lerp(item.x, logoX, 0.9); 
      item.y = lerp(item.y, logoY, 0.9);
      
      stroke(255, 200);
      strokeWeight(2);
      line(item.x, item.y, logoX, logoY);

      if (!isFist) {
        checkClassification(item);
        items.splice(i, 1);
        grabbedItem = null;
        continue;
      }
    } else {
      item.y += item.speed; 
      
      let d = dist(logoX, logoY, item.x, item.y);
      // 💡 優化：放寬碰撞判定範圍 (60 -> 100)，解決抓不到垃圾的問題
      if (isFist && d < 100 && grabbedItem === null) {
        grabbedItem = item;
      }
    }
    
    // 渲染垃圾（含文字陰影）
    fill(0, 150);
    textSize(28);
    textAlign(CENTER, CENTER);
    text(item.name, item.x + 2, item.y + 2); 
    fill(255);
    text(item.name, item.x, item.y);
    
    if (item.y > height) {
      items.splice(i, 1);
      score = max(0, score - 2); 
    }
  }
  
  drawUI();
}

function checkClassification(item) {
  let choice = "";
  if (item.x < width / 3) choice = "回收";
  else if (item.x < (width / 3) * 2) choice = "一般";
  else choice = "廚餘";
  
  // 💡 優化：只要在下半部區域放開就判定
  if (item.y > height - 250) {
    if (item.type === choice) {
      score += 10;
      showFeedback("+10", item.x, item.y, "#4CAF50");
    } else {
      score = max(0, score - 5);
      showFeedback("-5", item.x, item.y, "#F44336");
    }
  }
}

function showFeedback(txt, x, y, color) {
  feedbackText = { txt: txt, x: x, y: y, timer: 50, color: color };
}

function drawBins() {
  stroke(255, 80);
  strokeWeight(2);
  
  // 判斷當前抓著的垃圾應該去哪裡，增加提示效果
  let highlightIdx = -1;
  if (grabbedItem) {
    if (logoX < width / 3) highlightIdx = 0;
    else if (logoX < (width / 3) * 2) highlightIdx = 1;
    else highlightIdx = 2;
  }

  // 資源回收（藍）
  fill(33, 150, 243, highlightIdx === 0 ? 255 : 150);
  rect(0, height - 80, width/3, 80, 10, 10, 0, 0);
  
  // 一般垃圾（灰）
  fill(158, 158, 158, highlightIdx === 1 ? 255 : 150);
  rect(width/3, height - 80, width/3, 80, 10, 10, 0, 0);
  
  // 廚餘桶（綠）
  fill(76, 175, 80, highlightIdx === 2 ? 255 : 150);
  rect((width/3)*2, height - 80, width/3, 80, 10, 10, 0, 0);
  
  // 垃圾桶文字
  fill(255);
  noStroke();
  textSize(20);
  textAlign(CENTER, CENTER);
  text("♻️ 資源回收", width/6, height - 40);
  text("🗑️ 一般垃圾", width/2, height - 40);
  text("🍎 廚餘桶", (width/6)*5, height - 40);
}

function drawUI() {
  fill(0, 180);
  noStroke();
  rect(20, 20, 160, 50, 10);
  fill(255);
  textSize(20);
  textAlign(LEFT, CENTER);
  text("得分: " + score, 40, 45);
  
  fill(0, 180);
  rect(width - 180, 20, 160, 50, 10);
  fill(gameTimer <= 10 ? "#FF5722" : 255); 
  textSize(20);
  textAlign(LEFT, CENTER);
  text("時間: " + gameTimer + "s", width - 150, 45);
}

function updateTimer() {
  if (millis() - lastTimeCheck >= 1000) {
    gameTimer--;
    lastTimeCheck = millis();
    if (gameTimer <= 0) {
      gameState = "OVER";
    }
  }
}

function drawStartScreen() {
  fill(255);
  textAlign(CENTER, CENTER);
  
  textSize(40);
  text("🌟 AR 環保小尖兵 🌟", width / 2, height / 2 - 100);
  
  textSize(20);
  fill(200);
  text("【遊戲操作指南】\n\n1. 張開手掌移動紅色光圈對準掉落的垃圾。\n2. 「握拳」即可抓起垃圾，並移動到對應垃圾桶。\n3. 在垃圾桶區域「放開手掌」進行分類！", width / 2, height / 2 + 10);
  
  fill(76, 175, 80);
  noStroke();
  rectMode(CENTER);
  rect(width / 2, height / 2 + 150, 160, 50, 25);
  fill(255);
  textSize(22);
  text("開始挑戰", width / 2, height / 2 + 150);
  rectMode(CORNER); 
}

function drawOverScreen() {
  fill(255);
  textAlign(CENTER, CENTER);
  
  textSize(46);
  fill("#FFEB3B");
  text("⏳ 挑戰結束！", width / 2, height / 2 - 80);
  
  textSize(28);
  fill(255);
  text("你的最終得分：" + score + " 分", width / 2, height / 2);
  
  textSize(18);
  fill(180);
  if(score >= 150) text("太厲害了！你簡置是環保大師！", width / 2, height / 2 + 50);
  else if(score >= 80) text("做得好！地球感謝你的付出！", width / 2, height / 2 + 50);
  else text("再接再厲，多練習分類可以拯救更多綠地！", width / 2, height / 2 + 50);

  fill(33, 150, 243);
  rectMode(CENTER);
  rect(width / 2, height / 2 + 150, 160, 50, 25);
  fill(255);
  textSize(22);
  text("再玩一次", width / 2, height / 2 + 150);
  rectMode(CORNER);
}

function mousePressed() {
  if (gameState === "START" || gameState === "OVER") {
    if (mouseX > width/2 - 80 && mouseX < width/2 + 80 && 
        mouseY > height/2 + 125 && mouseY < height/2 + 175) {
      resetGame();
    }
  }
}

function resetGame() {
  score = 0;
  gameTimer = 30;
  items = [];
  grabbedItem = null;
  lastTimeCheck = millis();
  gameState = "PLAY";
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}