#include <iostream>
// @phase setup
int main() {
    int n = {{n}};
    int values[30] = {};
    // @phase input
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> values[i];
    }
    // @phase insert
    for (int i = 1; i < n; i = i + 1) {
        int key = values[i];
        int j = i - 1;
        // @phase shift
        while (j >= 0 && values[j] > key) {
            values[j + 1] = values[j];
            j = j - 1;
        }
        // @phase place
        values[j + 1] = key;
    }
    // @phase output
    for (int i = 0; i < n; i = i + 1) {
        std::cout << values[i] << " ";
    }
    std::cout << "\n";
    return 0;
}
