#include <iostream>
void move(int rods[], int height[], int count, int from, int to, int spare) {
    if (count == 0) { return; }
    move(rods, height, count - 1, from, spare, to);
    height[from] = height[from] - 1;
    int disk = rods[from * 5 + height[from]];
    rods[from * 5 + height[from]] = 0;
    rods[to * 5 + height[to]] = disk;
    height[to] = height[to] + 1;
    std::cout << from + 1 << " " << to + 1 << "\n";
    move(rods, height, count - 1, spare, to, from);
}

int main() {
    int n; std::cin >> n; int rods[15] = {}; int height[3] = {}; height[0] = n;
    for (int i = 0; i < n; i = i + 1) { rods[i] = n - i; }
    // 开始观察算法
    move(rods, height, n, 0, 2, 1);
    return 0;
}
