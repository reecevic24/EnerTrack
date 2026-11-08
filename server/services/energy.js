'use strict';

function calculateInventoryTotals(items, tariffRate, emissionFactor) {
    return items.reduce((totals, item) => {
        const dailyKwh = (item.watts * item.qty * item.hours) / 1000;
        const monthlyKwh = dailyKwh * 30;
        totals.monthlyKwh += monthlyKwh;
        totals.monthlyCost += monthlyKwh * tariffRate;
        totals.monthlyCarbon += monthlyKwh * emissionFactor;
        totals.activePowerKw += (item.watts * item.qty) / 1000;
        return totals;
    }, { monthlyKwh: 0, monthlyCost: 0, monthlyCarbon: 0, activePowerKw: 0 });
}

module.exports = { calculateInventoryTotals };
