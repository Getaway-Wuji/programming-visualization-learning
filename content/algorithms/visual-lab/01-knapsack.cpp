#include <iostream>

int main() {
    int n; int capacity; std::cin >> n >> capacity;
    int weight[4]; int value[4];
    for (int i = 0; i < n; i = i + 1) { std::cin >> weight[i] >> value[i]; }
    int rows = n + 1; int cols = capacity + 1; int dp[45] = {};
    // 开始观察算法
    for (int i = 1; i <= n; i = i + 1) {
        for (int j = 0; j <= capacity; j = j + 1) {
            dp[i * cols + j] = dp[(i - 1) * cols + j];
            if (j >= weight[i - 1]) {
                int candidate = dp[(i - 1) * cols + j - weight[i - 1]] + value[i - 1];
                if (candidate > dp[i * cols + j]) { dp[i * cols + j] = candidate; }
            }
        }
    }
    std::cout << dp[n * cols + capacity] << "\n";
    return 0;
}
