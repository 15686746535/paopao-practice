<template>
  <view class="page">
    <scroll-view class="scroll" scroll-y>
      <view class="doc">
        <view class="h1">{{ isPrivacy ? "隐私政策" : "用户协议" }}</view>
        <view class="muted">更新日期：2026-09-25 · 生效日期：2026-09-25</view>

        <template v-if="!isPrivacy">
          <view class="h2">一、协议范围</view>
          <view class="p">本协议是您与【 TODO:公司主体全称 】（以下简称"本应用"）之间就使用"泡泡练琴"软件服务所订立的协议。您使用本应用即视为同意本协议全部条款。</view>
          <view class="h2">二、服务内容</view>
          <view class="p">本应用提供蓝牙钢琴连接、跟弹练习、曲谱浏览与练习统计等功能。曲库内容来自公开曲库（传统曲调与公有领域作品），具体来源见"关于"页。</view>
          <view class="h2">三、用户行为规范</view>
          <view class="p">您承诺不利用本应用从事违法违规活动，不上传、分发侵犯他人知识产权的曲谱内容。您自行导入的曲谱仅限个人学习使用。</view>
          <view class="h2">四、知识产权</view>
          <view class="p">本应用的界面设计、代码、商标归【 TODO:公司主体 】所有。第三方曲库数据按其原始授权使用并在"关于"页注明来源。</view>
          <view class="h2">五、免责声明</view>
          <view class="p">本应用按"现状"提供。因设备兼容性、蓝牙连接等因素导致的功能异常，本应用不承担责任。练习数据保存在您的设备本地，请自行备份。</view>
          <view class="h2">六、协议变更与终止</view>
          <view class="p">我们可能不时更新本协议，更新后将在应用内公布。若您不同意变更内容，可停止使用本应用。</view>
          <view class="h2">七、联系我们</view>
          <view class="p">客服邮箱：【 TODO:客服邮箱 】</view>
        </template>

        <template v-else>
          <view class="h2">一、我们收集的信息</view>
          <view class="p">本应用<b>不收集</b>您的个人信息：不注册账号、不获取通讯录/位置/相册权限。蓝牙权限仅在连接钢琴时使用，不会用于其他目的。</view>
          <view class="h2">二、本地存储的数据</view>
          <view class="p">以下数据仅保存在您的设备本地，我们无法访问：曲谱库、练习记录（时间/得分/曲目名）、练习偏好设置。</view>
          <view class="h2">三、数据共享</view>
          <view class="p">我们不向任何第三方共享、出售您的数据。练习数据不上传服务器。</view>
          <view class="h2">四、未成年人保护</view>
          <view class="p">本应用适合各年龄段学习者使用，不包含社交与支付诱导功能。若后续上线会员付费，将按法规要求提供未成年人退款渠道。</view>
          <view class="h2">五、联系我们</view>
          <view class="p">隐私问题反馈：【 TODO:客服邮箱 】</view>
        </template>
      </view>
    </scroll-view>
  </view>
</template>

<script>
export default {
  data() {
    return { isPrivacy: false };
  },
  onLoad(options) {
    this.isPrivacy = options.kind === "privacy";
    uni.setNavigationBarTitle({ title: this.isPrivacy ? "隐私政策" : "用户协议" });
  },
};
</script>

<style>
.page { height: 100vh; }
.scroll { height: 100%; }
.doc { padding: 20px 18px 40px; }
.h1 { font-size: 20px; font-weight: 800; margin-bottom: 6px; }
.h2 { font-size: 15.5px; font-weight: 700; margin: 18px 0 6px; }
.p { font-size: 14px; line-height: 1.8; color: #3a3f4c; }
</style>
