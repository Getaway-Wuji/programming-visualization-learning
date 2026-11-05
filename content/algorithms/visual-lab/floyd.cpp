#include <iostream>

int main() {
    int n; int edges; int start; int mode;
    std::cin >> n >> edges >> start >> mode;
    int graph[36] = {};
    for (int edge = 0; edge < edges; edge = edge + 1) {
        int u; int v; int weight; std::cin >> u >> v >> weight;
        graph[u * n + v] = weight;
        // UNDIRECTED
    }
    int dp[36]; int rows = n; int cols = n;
    for (int i = 0; i < n; i = i + 1) {
        for (int j = 0; j < n; j = j + 1) {
            dp[i * n + j] = 10000;
            if (i == j) { dp[i * n + j] = 0; }
            else if (graph[i * n + j] > 0) { dp[i * n + j] = graph[i * n + j]; }
        }
    }
    // 开始观察算法
    for (int k = 0; k < n; k = k + 1) {
        for (int i = 0; i < n; i = i + 1) {
            for (int j = 0; j < n; j = j + 1) {
                int candidate = dp[i * n + k] + dp[k * n + j];
                if (candidate < dp[i * n + j]) { dp[i * n + j] = candidate; }
            }
        }
    }
    for (int i = 0; i < n; i = i + 1) {
        for (int j = 0; j < n; j = j + 1) {
            if (dp[i * n + j] == 10000) { std::cout << "inf "; } else { std::cout << dp[i * n + j] << " "; }
        }
        std::cout << "\n";
    }
    return 0;
}
