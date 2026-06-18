const { PermissionFlagsBits } = require('discord.js');

/**
 * Check if a member has Administrator permission
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Check if the bot has Manage Roles permission and role is lower than bot's highest role
 * @param {import('discord.js').Guild} guild
 * @param {string} roleId
 * @returns {{canManage: boolean, reason?: string}}
 */
function canManageRole(guild, roleId) {
  const botMember = guild.members.me;
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { canManage: false, reason: 'I do not have the **Manage Roles** permission.' };
  }

  const role = guild.roles.cache.get(roleId);
  if (!role) {
    return { canManage: false, reason: 'That role does not exist in this server.' };
  }

  const botHighestRole = botMember.roles.highest;
  if (role.position >= botHighestRole.position) {
    return { canManage: false, reason: `The role **${role.name}** is higher than or equal to my highest role. I cannot assign it.` };
  }

  return { canManage: true };
}

module.exports = {
  isAdmin,
  canManageRole,
};
