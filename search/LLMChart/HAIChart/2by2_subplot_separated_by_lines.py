
from matplotlib import pyplot as plt

plt.figure(figsize=(8, 8))

# plt.axes(rect, ...),
# where *rect* = [left, bottom, width, height] in normalized (0, 1) units
ax0 = plt.axes([0, 0, 1, 1])
ax0.set_xticks([])
ax0.set_yticks([])

ax1 = plt.axes([0.1, 0.6, 0.3, 0.3])

ax2 = plt.axes([0.6, 0.6, 0.3, 0.3])

ax3 = plt.axes([0.1, 0.1, 0.3, 0.3])

ax4 = plt.axes([0.6, 0.1, 0.3, 0.3])

ax0.plot([0.5, 0.5], [0, 1], color='lightgreen', lw=5)
ax0.plot([0, 1], [0.5, 0.5], color='lightgreen', lw=5)

plt.show()
