#include <iostream>
// @phase setup
int main() {
    int n = {{n}};
    int values[30] = {};
    // @phase input
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> values[i];
    }
    // @phase buckets
    int counts[41] = {};
    // @phase count
    for (int i = 0; i < n; i = i + 1) {
        int bucket = values[i] + 20;
        counts[bucket] = counts[bucket] + 1;
    }
    // @phase rebuild
    int at = 0;
    for (int bucket = 0; bucket < 41; bucket = bucket + 1) {
        while (counts[bucket] > 0) {
            values[at] = bucket - 20;
            at = at + 1;
            counts[bucket] = counts[bucket] - 1;
        }
    }
    // @phase output
    for (int i = 0; i < n; i = i + 1) {
        std::cout << values[i] << " ";
    }
    std::cout << "\n";
    return 0;
}
