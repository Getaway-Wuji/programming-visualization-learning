#include <iostream>

int main() {
    int n; std::cin >> n; int a[12] = {}; int dp[12] = {};
    for (int i = 0; i < n; i = i + 1) { std::cin >> a[i]; }
    int answer = 0;
    // 开始观察算法
    for (int i = 0; i < n; i = i + 1) {
        int best = 1;
        for (int j = 0; j < i; j = j + 1) { if (a[j] < a[i] && dp[j] + 1 > best) { best = dp[j] + 1; } }
        dp[i] = best; if (best > answer) { answer = best; }
    }
    std::cout << answer << "\n";
    return 0;
}
