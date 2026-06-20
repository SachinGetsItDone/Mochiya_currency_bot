const { EmbedBuilder } = require('discord.js');

const COLORS = {
  primary: 0xFFB6C1,    // Soft light pink (Mochi brand)
  success: 0x2ECC71,    // Emerald green
  error: 0xE74C3C,      // Alizarin red
  warning: 0xF1C40F,    // Sunflower yellow
  info: 0x3498DB,       // Peter River blue
  gold: 0xF1C40F,       // Gold/Yellow for economy
  epic: 0x9B59B6,       // Amethyst purple
  legendary: 0xE67E22,  // Orange
  roulette: 0x8B0000,   // Dark crimson (Russian Roulette)
};

function baseEmbed(user = null) {
  const embed = new EmbedBuilder()
    .setTimestamp()
    .setFooter({ text: '🍡 Mochi Bot' });

  if (user) {
    embed.setThumbnail(user.displayAvatarURL({ dynamic: true }));
  }
  return embed;
}

function success(title, description, user = null) {
  return baseEmbed(user)
    .setColor(COLORS.success)
    .setTitle(`✅ ${title}`)
    .setDescription(description);
}

function error(title, description, user = null) {
  return baseEmbed(user)
    .setColor(COLORS.error)
    .setTitle(`❌ ${title}`)
    .setDescription(description);
}

function info(title, description, user = null) {
  return baseEmbed(user)
    .setColor(COLORS.info)
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description);
}

function warning(title, description, user = null) {
  return baseEmbed(user)
    .setColor(COLORS.warning)
    .setTitle(`⚠️ ${title}`)
    .setDescription(description);
}

function economy(title, description, user = null) {
  return baseEmbed(user)
    .setColor(COLORS.gold)
    .setTitle(`🪙 ${title}`)
    .setDescription(description);
}

function shop(title, description, user = null) {
  return baseEmbed(user)
    .setColor(COLORS.primary)
    .setTitle(`🛒 ${title}`)
    .setDescription(description);
}

function collection(title, fields = [], user = null) {
  const embed = baseEmbed(user)
    .setColor(COLORS.epic)
    .setTitle(`🏆 ${title}`);
  
  if (fields.length > 0) {
    embed.addFields(fields);
  }
  
  return embed;
}

function tournament(title, description, user = null) {
  return baseEmbed(user)
    .setColor(COLORS.info)
    .setTitle(`🏅 ${title}`)
    .setDescription(description);
}

function betting(title, description, user = null) {
  return baseEmbed(user)
    .setColor(COLORS.warning)
    .setTitle(`🎲 ${title}`)
    .setDescription(description);
}

function roulette(title, description, user = null) {
  return baseEmbed(user)
    .setColor(COLORS.roulette)
    .setTitle(`🔫 ${title}`)
    .setDescription(description);
}

function getRarityColor(rarity) {
  switch (rarity?.toLowerCase()) {
    case 'common': return 0x95A5A6;
    case 'rare': return 0x3498DB;
    case 'epic': return COLORS.epic;
    case 'legendary': return COLORS.legendary;
    default: return COLORS.primary;
  }
}

module.exports = {
  COLORS,
  success,
  error,
  info,
  warning,
  economy,
  shop,
  collection,
  tournament,
  betting,
  roulette,
  getRarityColor,
};
